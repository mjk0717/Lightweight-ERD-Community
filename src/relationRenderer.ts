import { state } from './state';
import { theme } from './theme';
import { closest } from './util';
import { entityRenderer } from './entityRenderer';
import { modalRelation } from './modalRelation';
import { contextMenu } from './contextMenu';
import { viewport } from './viewport';
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

// Resolves an endpoint's Y position: the anchor-fraction override if one is
// set (dragged there by the user), otherwise the default row-center Y.
function anchorY(box: Box, defaultRowY: number, t: number | undefined): number {
  if (t === undefined) return defaultRowY;
  return box.y + box.h * t;
}

function bezierPointAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  };
}

// Crow's foot/one-many markers reach up to ~24px out from the entity edge
// (see cardinalityMarker's distances below). The marker itself is drawn at
// the actual entity edge (geom.aPt/bPt, see updateRelationNode) - this is
// how far past the marker's own reach the curve's bend point sits, so the
// line never bends back through the marker shape. Kept fixed regardless of
// how close two entities are; if that means the two ends overshoot each
// other, the connecting curve just loops back through the middle instead of
// shrinking the reserved space (which would compress/break the marker).
const MARKER_CLEARANCE = 32;

function markerAnchor(edge: Point, side: 'left' | 'right'): Point {
  const dir = side === 'right' ? 1 : -1;
  return { x: edge.x + dir * MARKER_CLEARANCE, y: edge.y };
}

// Endpoint drag handles sit a few px off the entity edge, in the empty
// canvas gap, rather than exactly on it - the entity div overlaps that
// pixel and renders on top of the SVG, so a handle drawn right at the edge
// is partly (or, for a left-attached edge, entirely) unclickable underneath
// the entity's own hit area.
const HANDLE_OFFSET = 9;
function handleAnchor(edge: Point, side: 'left' | 'right'): Point {
  const dir = side === 'right' ? 1 : -1;
  return { x: edge.x + dir * HANDLE_OFFSET, y: edge.y };
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
      // Crow's foot converges at 12; circle (radius 4) centered at 16 so its
      // near edge touches the foot's tip instead of floating past it.
      g.appendChild(crowFoot(point, side));
      g.appendChild(circle(point, side, 16));
      break;
    case 'one-or-many':
      // Bar sits right at the foot's convergence point, capping it.
      g.appendChild(crowFoot(point, side));
      g.appendChild(bar(point, side, 12));
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
  g.appendChild(el('g', { class: 'relation-handles' }));
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

  const aRowY = anchorY(aBox, aRow.y, relation.sourceAnchorT);
  const bRowY = anchorY(bBox, bRow.y, relation.targetAnchorT);
  const geom = computeEndpoints(aBox, aRowY, bBox, bRowY, relation.sourceEntityId === relation.targetEntityId);
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

  // Markers sit right at the entity edge; markerAnchor() (used inside
  // linePath) is what reserves the clearance past the marker before the
  // curve is allowed to start bending - order is edge -> marker ->
  // MARKER_CLEARANCE -> curve -> MARKER_CLEARANCE -> marker -> edge.
  const endpoints = node.querySelector('.relation-endpoints') as SVGGElement;
  endpoints.innerHTML = '';
  endpoints.appendChild(cardinalityMarker(geom.aPt, geom.aSide, sourceCardinalityOf(relation)));
  endpoints.appendChild(cardinalityMarker(geom.bPt, geom.bSide, targetCardinalityOf(relation)));

  // Endpoint drag handles - only shown once the relation is selected, so
  // they don't clutter the diagram; dragging one re-points that end to a
  // different entity (see onHandleMouseDown).
  const handles = node.querySelector('.relation-handles') as SVGGElement;
  handles.innerHTML = '';
  if (isSelected) {
    const sourceHandlePt = handleAnchor(geom.aPt, geom.aSide);
    const targetHandlePt = handleAnchor(geom.bPt, geom.bSide);
    handles.appendChild(el('circle', {
      class: 'relation-handle', 'data-end': 'source', cx: sourceHandlePt.x, cy: sourceHandlePt.y, r: 6,
      fill: theme.colors.relationStrokeHover, stroke: '#ffffff', 'stroke-width': 2
    }));
    handles.appendChild(el('circle', {
      class: 'relation-handle', 'data-end': 'target', cx: targetHandlePt.x, cy: targetHandlePt.y, r: 6,
      fill: theme.colors.relationStrokeHover, stroke: '#ffffff', 'stroke-width': 2
    }));
  }

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

// Dragging an endpoint handle re-points that end of an already-created
// relation to a different entity, rather than only being settable when the
// relation is first drawn.
// Purely a visual adjustment - lets an endpoint be repositioned anywhere
// along its own entity's edge (clamped to the entity's height), without
// touching which entity/column the relation actually connects. The entity
// and column stay exactly what they were; only sourceAnchorT/targetAnchorT
// (a 0-1 fraction of the entity's height) changes.
function onHandleMouseDown(e: MouseEvent): void {
  const handle = closest(e.target as HTMLElement, (n) => n.classList && n.classList.contains('relation-handle'));
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();

  const g = closest(handle, (n) => n.classList && n.classList.contains('relation'))!;
  const relationId = g.dataset.relationId!;
  const end = handle.dataset.end as 'source' | 'target';
  const relation = state.getRelation(relationId);
  if (!relation) return;
  const entityId = end === 'source' ? relation.sourceEntityId : relation.targetEntityId;
  const box = entityRenderer.getEntityBox(entityId);
  if (!box) return;

  const otherHandle = g.querySelector('.relation-handle[data-end="' + (end === 'source' ? 'target' : 'source') + '"]') as SVGCircleElement | null;
  if (!otherHandle) return;
  const fixedPt = { x: Number(otherHandle.getAttribute('cx')), y: Number(otherHandle.getAttribute('cy')) };
  const draggedX = Number(handle.getAttribute('cx'));

  let lastT: number | undefined;

  function onMove(ev: MouseEvent): void {
    const world = viewport.screenToWorld(ev.clientX, ev.clientY);
    const clampedY = Math.min(Math.max(world.y, box!.y), box!.y + box!.h);
    lastT = (clampedY - box!.y) / box!.h;
    setTempLine(fixedPt, { x: draggedX, y: clampedY });
  }
  function onUp(): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearTempLine();
    if (lastT === undefined) return;
    state.updateRelation(relationId, end === 'source' ? { sourceAnchorT: lastT } : { targetAnchorT: lastT });
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
  svgEl.addEventListener('mousedown', onHandleMouseDown as EventListener);
  svgEl.addEventListener('click', onClick as EventListener);
  svgEl.addEventListener('dblclick', onDblClick as EventListener);
  svgEl.addEventListener('contextmenu', onContextMenu as EventListener);
  state.on('change', render);
  state.on('move', render);
  state.on('select', render);
  render();
}

export const relationRenderer = { init, render, setTempLine, clearTempLine };
