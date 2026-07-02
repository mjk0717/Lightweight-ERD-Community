import { state } from './state';
import { theme } from './theme';
import { closest } from './util';
import { entityRenderer } from './entityRenderer';
import { modalRelation } from './modalRelation';
import { contextMenu } from './contextMenu';
import { Box, Point, Relation } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
let svgEl: SVGSVGElement;
let relGroup: SVGGElement;
let tempGroup: SVGGElement;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  if (attrs) Object.keys(attrs).forEach((k) => n.setAttribute(k, String(attrs[k])));
  return n;
}

interface Endpoints {
  aPt: Point;
  bPt: Point;
  aSide: 'left' | 'right';
  bSide: 'left' | 'right';
}

// Decide which vertical edge of each box the connector attaches to, based
// on the relative horizontal position of the two boxes.
function computeEndpoints(aBox: Box, aRowY: number, bBox: Box, bRowY: number): Endpoints {
  const aCenterX = aBox.x + aBox.w / 2, bCenterX = bBox.x + bBox.w / 2;
  let aSide: 'left' | 'right', bSide: 'left' | 'right';
  if (aCenterX <= bCenterX) { aSide = 'right'; bSide = 'left'; } else { aSide = 'left'; bSide = 'right'; }
  const aPt = { x: aSide === 'right' ? aBox.x + aBox.w : aBox.x, y: aRowY };
  const bPt = { x: bSide === 'right' ? bBox.x + bBox.w : bBox.x, y: bRowY };
  return { aPt, bPt, aSide, bSide };
}

function bezierPointAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  };
}

function bezierPath(aPt: Point, aSide: 'left' | 'right', bPt: Point, bSide: 'left' | 'right') {
  const dx = Math.max(Math.abs(bPt.x - aPt.x) * 0.5, 50);
  const c1 = { x: aPt.x + (aSide === 'right' ? dx : -dx), y: aPt.y };
  const c2 = { x: bPt.x + (bSide === 'right' ? dx : -dx), y: bPt.y };
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y + ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + bPt.x + ' ' + bPt.y,
    mid: bezierPointAt(aPt, c1, c2, bPt, 0.5)
  };
}

function crowFoot(point: Point, side: 'left' | 'right'): SVGGElement {
  const dir = side === 'right' ? 1 : -1;
  const back = { x: point.x + dir * 12, y: point.y };
  const g = el('g', { class: 'crowfoot' });
  [-6, 0, 6].forEach((off) => {
    g.appendChild(el('line', {
      x1: back.x, y1: back.y + off, x2: point.x, y2: point.y,
      stroke: theme.colors.relationStroke, 'stroke-width': 1.5
    }));
  });
  return g;
}

function oneTick(point: Point, side: 'left' | 'right'): SVGLineElement {
  const dir = side === 'right' ? 1 : -1;
  const back = { x: point.x + dir * 9, y: point.y };
  return el('line', {
    x1: back.x, y1: back.y - 6, x2: back.x, y2: back.y + 6,
    stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

function buildRelationNode(relation: Relation): SVGGElement {
  const g = el('g', { class: 'relation', 'data-relation-id': relation.id });
  g.appendChild(el('path', { class: 'relation-hit' }));
  g.appendChild(el('path', { class: 'relation-line' }));
  g.appendChild(el('g', { class: 'relation-endpoints' }));
  const label = el('g', { class: 'relation-label' });
  label.appendChild(el('rect', { class: 'relation-label-bg' }));
  label.appendChild(el('text', { class: 'relation-label-text' }));
  g.appendChild(label);
  return g;
}

function updateRelationNode(node: SVGGElement, relation: Relation): void {
  const aBox = entityRenderer.getEntityBox(relation.sourceEntityId);
  const bBox = entityRenderer.getEntityBox(relation.targetEntityId);
  if (!aBox || !bBox) { node.style.display = 'none'; return; }
  node.style.display = '';
  const aRow = entityRenderer.getColumnRowCenter(relation.sourceEntityId, relation.sourceColumnId);
  const bRow = entityRenderer.getColumnRowCenter(relation.targetEntityId, relation.targetColumnId);
  if (!aRow || !bRow) { node.style.display = 'none'; return; }

  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y);
  const path = bezierPath(geom.aPt, geom.aSide, geom.bPt, geom.bSide);

  const selected = state.data.selected;
  const isSelected = !!(selected && selected.type === 'relation' && selected.id === relation.id);

  const line = node.querySelector('.relation-line') as SVGPathElement;
  line.setAttribute('d', path.d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', isSelected ? theme.colors.relationStrokeHover : theme.colors.relationStroke);
  line.setAttribute('stroke-width', isSelected ? '2.5' : '1.5');

  const hit = node.querySelector('.relation-hit') as SVGPathElement;
  hit.setAttribute('d', path.d);
  hit.setAttribute('fill', 'none');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', '12');

  const endpoints = node.querySelector('.relation-endpoints') as SVGGElement;
  endpoints.innerHTML = '';
  endpoints.appendChild(crowFoot(geom.aPt, geom.aSide));
  endpoints.appendChild(oneTick(geom.bPt, geom.bSide));

  const labelGroup = node.querySelector('.relation-label') as SVGGElement;
  const text = labelGroup.querySelector('.relation-label-text') as SVGTextElement;
  const bg = labelGroup.querySelector('.relation-label-bg') as SVGRectElement;
  if (relation.name) {
    text.textContent = relation.name;
    labelGroup.style.display = '';
    text.setAttribute('x', String(path.mid.x));
    text.setAttribute('y', String(path.mid.y + 4));
    text.setAttribute('text-anchor', 'middle');
    // measure after placing in DOM
    requestAnimationFrame(() => {
      try {
        const bbox = text.getBBox();
        bg.setAttribute('x', String(bbox.x - 4));
        bg.setAttribute('y', String(bbox.y - 2));
        bg.setAttribute('width', String(bbox.width + 8));
        bg.setAttribute('height', String(bbox.height + 4));
      } catch (e) { /* getBBox can throw if not yet laid out - next render() call will retry */ }
    });
  } else {
    labelGroup.style.display = 'none';
  }
}

const nodeMap = new Map<string, SVGGElement>();

function render(): void {
  const relations = state.data.relations;
  const seen = new Set<string>();
  relations.forEach((relation) => {
    seen.add(relation.id);
    let node = nodeMap.get(relation.id);
    if (!node) {
      node = buildRelationNode(relation);
      nodeMap.set(relation.id, node);
      relGroup.appendChild(node);
    }
    updateRelationNode(node, relation);
  });
  nodeMap.forEach((node, id) => {
    if (!seen.has(id)) { node.remove(); nodeMap.delete(id); }
  });
}

function setTempLine(fromPt: Point, toPt: Point): void {
  tempGroup.style.display = '';
  tempGroup.innerHTML = '';
  const side = toPt.x >= fromPt.x ? 'right' : 'left';
  const otherSide = side === 'right' ? 'left' : 'right';
  const path = bezierPath(fromPt, side, toPt, otherSide);
  const p = el('path', { d: path.d, fill: 'none', stroke: theme.colors.relationStrokeHover, 'stroke-width': 2, 'stroke-dasharray': '5,4' });
  tempGroup.appendChild(p);
}

function clearTempLine(): void {
  tempGroup.style.display = 'none';
  tempGroup.innerHTML = '';
}

function onClick(e: MouseEvent): void {
  const g = closest(e.target as HTMLElement, (n) => n.classList && n.classList.contains('relation'));
  if (!g) return;
  state.select('relation', g.dataset.relationId!);
  modalRelation.openEdit(g.dataset.relationId!);
}

function onContextMenu(e: MouseEvent): void {
  const g = closest(e.target as HTMLElement, (n) => n.classList && n.classList.contains('relation'));
  if (!g) return;
  e.preventDefault();
  state.select('relation', g.dataset.relationId!);
  contextMenu.showForRelation(g.dataset.relationId!, e.clientX, e.clientY);
}

function init(svg: SVGSVGElement): void {
  svgEl = svg;
  relGroup = el('g', { class: 'relations' });
  tempGroup = el('g', { class: 'temp-relation' });
  tempGroup.style.display = 'none';
  svgEl.appendChild(relGroup);
  svgEl.appendChild(tempGroup);
  svgEl.addEventListener('click', onClick as EventListener);
  svgEl.addEventListener('contextmenu', onContextMenu as EventListener);
  state.on('change', render);
  state.on('move', render);
  state.on('select', render);
  render();
}

export const relationRenderer = { init, render, setTempLine, clearTempLine };
