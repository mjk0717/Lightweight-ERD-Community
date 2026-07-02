import { state } from './state';
import { theme } from './theme';
import { closest } from './util';
import { entityRenderer } from './entityRenderer';
import { modalRelation } from './modalRelation';
import { contextMenu } from './contextMenu';
import { sourceCardinalityOf, targetCardinalityOf } from './cardinality';
import { Box, Cardinality, Point, Relation } from './types';

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
// on the relative horizontal position of the two boxes. Self-referencing
// relations (same entity on both ends) attach both points to the same edge
// so the curve loops out and back around instead of cutting through the box.
function computeEndpoints(aBox: Box, aRowY: number, bBox: Box, bRowY: number, isSelf: boolean): Endpoints {
  if (isSelf) {
    const aPt = { x: aBox.x, y: aRowY };
    const bPt = { x: bBox.x, y: bRowY };
    return { aPt, bPt, aSide: 'left', bSide: 'left' };
  }
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

// Crow's foot/one-many markers reach up to ~20px out from the entity edge.
// When two entities sit close together, the marker at one end can run past
// the other end's marker and the shapes collide/overlap. Always reserve a
// fixed clearance stub at each end - regardless of how close the entities
// are - so the marker itself never gets compressed or broken; if the boxes
// are closer than 2x this stub, the connecting curve simply loops back on
// itself in the middle rather than shrinking the guaranteed lead-in.
const MARKER_CLEARANCE = 32;

function markerAnchor(edge: Point, side: 'left' | 'right'): Point {
  const dir = side === 'right' ? 1 : -1;
  return { x: edge.x + dir * MARKER_CLEARANCE, y: edge.y };
}

function bezierPath(aPt: Point, aSide: 'left' | 'right', bPt: Point, bSide: 'left' | 'right') {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dx = Math.max(Math.abs(markerB.x - markerA.x) * 0.5, 50);
  const c1 = { x: markerA.x + (aSide === 'right' ? dx : -dx), y: markerA.y };
  const c2 = { x: markerB.x + (bSide === 'right' ? dx : -dx), y: markerB.y };
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: bezierPointAt(markerA, c1, c2, markerB, 0.5)
  };
}

// Right-angle "elbow" routing: out horizontally from A, one vertical
// segment, then horizontally into B. Works for the self-relation case too,
// where both sides are equal and the elbow becomes a simple rectangular loop.
function angularPath(aPt: Point, aSide: 'left' | 'right', bPt: Point, bSide: 'left' | 'right') {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dx = Math.max(Math.abs(markerB.x - markerA.x) * 0.5, 50);
  const midAx = markerA.x + (aSide === 'right' ? dx : -dx);
  const midBx = markerB.x + (bSide === 'right' ? dx : -dx);
  const midX = (midAx + midBx) / 2;
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' L ' + midX + ' ' + markerA.y + ' L ' + midX + ' ' + markerB.y +
      ' L ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: { x: midX, y: (markerA.y + markerB.y) / 2 }
  };
}

function linePath(aPt: Point, aSide: 'left' | 'right', bPt: Point, bSide: 'left' | 'right') {
  return state.data.lineStyle === 'angular' ? angularPath(aPt, aSide, bPt, bSide) : bezierPath(aPt, aSide, bPt, bSide);
}

// Identifying relationship: the FK column also serves as (part of) the
// child's own primary key - drawn solid. Non-identifying (a plain
// attribute FK) is drawn dashed. This is derived straight from the column's
// current pk flag rather than stored separately, so toggling PK on that
// column in the table details modal is enough to change the line style.
function isIdentifying(relation: Relation): boolean {
  return relation.columnPairs.every((p) => {
    const col = state.getColumn(relation.sourceEntityId, p.sourceColumnId);
    return !!col && col.pk;
  });
}

// Same physical/logical convention as entity and column names: logical mode
// prefers the business-friendly relation name, falling back to the
// physical (constraint-style) name when no logical name is set.
function displayRelationName(relation: Relation): string {
  if (state.data.designMode === 'logical' && relation.logicalName) return relation.logicalName;
  return relation.name;
}

function crowFoot(point: Point, side: 'left' | 'right'): SVGGElement {
  // Prongs splay out right at the entity edge and converge to a single
  // point further along the line - like a foot planted against the box.
  const dir = side === 'right' ? 1 : -1;
  const forward = { x: point.x + dir * 12, y: point.y };
  const g = el('g', { class: 'crowfoot' });
  [-6, 6].forEach((off) => {
    g.appendChild(el('line', {
      x1: point.x, y1: point.y + off, x2: forward.x, y2: forward.y,
      stroke: theme.colors.relationStroke, 'stroke-width': 1.5
    }));
  });
  return g;
}

function bar(point: Point, side: 'left' | 'right', distance: number): SVGLineElement {
  const dir = side === 'right' ? 1 : -1;
  const x = point.x + dir * distance;
  return el('line', {
    x1: x, y1: point.y - 6, x2: x, y2: point.y + 6,
    stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

function circle(point: Point, side: 'left' | 'right', distance: number): SVGCircleElement {
  const dir = side === 'right' ? 1 : -1;
  return el('circle', {
    cx: point.x + dir * distance, cy: point.y, r: 4,
    fill: theme.colors.bodyBg, stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

// Crow's foot notation with optionality: the crow's foot (or bars) sit right
// at the entity edge; an outer bar/circle further along the line marks
// mandatory/optional. "many" alone (no outer mark) is also a valid choice.
function cardinalityMarker(point: Point, side: 'left' | 'right', cardinality: Cardinality): SVGGElement {
  const g = el('g', { class: 'cardinality-marker' });
  switch (cardinality) {
    case 'one':
      g.appendChild(bar(point, side, 9));
      g.appendChild(bar(point, side, 15));
      break;
    case 'zero-or-one':
      g.appendChild(bar(point, side, 9));
      g.appendChild(circle(point, side, 17));
      break;
    case 'zero-or-many':
      g.appendChild(crowFoot(point, side));
      g.appendChild(circle(point, side, 20));
      break;
    case 'one-or-many':
      g.appendChild(crowFoot(point, side));
      g.appendChild(bar(point, side, 16));
      break;
    case 'many':
    default:
      g.appendChild(crowFoot(point, side));
      break;
  }
  return g;
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
  // A composite (multi-column) FK still draws as a single line - anchored
  // on the first column pair's rows.
  const firstPair = relation.columnPairs[0];
  if (!firstPair) { node.style.display = 'none'; return; }
  const aRow = entityRenderer.getColumnRowCenter(relation.sourceEntityId, firstPair.sourceColumnId);
  const bRow = entityRenderer.getColumnRowCenter(relation.targetEntityId, firstPair.targetColumnId);
  if (!aRow || !bRow) { node.style.display = 'none'; return; }

  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y, relation.sourceEntityId === relation.targetEntityId);
  const path = linePath(geom.aPt, geom.aSide, geom.bPt, geom.bSide);

  const selected = state.data.selected;
  const isSelected = !!(selected && selected.type === 'relation' && selected.id === relation.id);

  const line = node.querySelector('.relation-line') as SVGPathElement;
  line.setAttribute('d', path.d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', isSelected ? theme.colors.relationStrokeHover : theme.colors.relationStroke);
  line.setAttribute('stroke-width', isSelected ? '2.5' : '1.5');
  if (isIdentifying(relation)) line.removeAttribute('stroke-dasharray');
  else line.setAttribute('stroke-dasharray', '6,4');

  const hit = node.querySelector('.relation-hit') as SVGPathElement;
  hit.setAttribute('d', path.d);
  hit.setAttribute('fill', 'none');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', '12');

  const endpoints = node.querySelector('.relation-endpoints') as SVGGElement;
  endpoints.innerHTML = '';
  endpoints.appendChild(cardinalityMarker(markerAnchor(geom.aPt, geom.aSide), geom.aSide, sourceCardinalityOf(relation)));
  endpoints.appendChild(cardinalityMarker(markerAnchor(geom.bPt, geom.bSide), geom.bSide, targetCardinalityOf(relation)));

  const labelGroup = node.querySelector('.relation-label') as SVGGElement;
  const text = labelGroup.querySelector('.relation-label-text') as SVGTextElement;
  const bg = labelGroup.querySelector('.relation-label-bg') as SVGRectElement;
  const labelText = displayRelationName(relation);
  if (labelText) {
    text.textContent = labelText;
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
  const path = linePath(fromPt, side, toPt, otherSide);
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
}

function onDblClick(e: MouseEvent): void {
  const g = closest(e.target as HTMLElement, (n) => n.classList && n.classList.contains('relation'));
  if (!g) return;
  state.select('relation', g.dataset.relationId!);
  modalRelation.openEdit(g.dataset.relationId!);
}

function onContextMenu(e: MouseEvent): void {
  const g = closest(e.target as HTMLElement, (n) => n.classList && n.classList.contains('relation'));
  if (!g) return;
  e.preventDefault();
  e.stopPropagation();
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
  svgEl.addEventListener('dblclick', onDblClick as EventListener);
  svgEl.addEventListener('contextmenu', onContextMenu as EventListener);
  state.on('change', render);
  state.on('move', render);
  state.on('select', render);
  render();
}

export const relationRenderer = { init, render, setTempLine, clearTempLine };
