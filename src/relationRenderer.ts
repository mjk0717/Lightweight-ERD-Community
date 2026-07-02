import { state } from './state';
import { theme } from './theme';
import { closest } from './util';
import { entityRenderer } from './entityRenderer';
import { modalRelation } from './modalRelation';
import { contextMenu } from './contextMenu';
import { viewport } from './viewport';
import { sourceCardinalityOf, targetCardinalityOf } from './cardinality';
import { Anchor, AnchorSide, Box, Cardinality, Point, Relation } from './types';

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
  aSide: AnchorSide;
  bSide: AnchorSide;
}

// Outward-facing unit vector for a given edge - "which way the line/marker
// points away from the box" for that side.
function sideDir(side: AnchorSide): Point {
  switch (side) {
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
  }
}

// The point at fraction t (0-1) along a given edge of a box - left/right run
// top-to-bottom, top/bottom run left-to-right.
function pointOnSide(box: Box, side: AnchorSide, t: number): Point {
  switch (side) {
    case 'left': return { x: box.x, y: box.y + box.h * t };
    case 'right': return { x: box.x + box.w, y: box.y + box.h * t };
    case 'top': return { x: box.x + box.w * t, y: box.y };
    case 'bottom': return { x: box.x + box.w * t, y: box.y + box.h };
  }
}

// Finds the closest point on any of a box's four edges to an arbitrary
// point (e.g. the cursor during an endpoint drag) - used so dragging can
// freely cross from one edge to another, not just slide along the original one.
function nearestAnchor(box: Box, pt: Point): Anchor {
  const edges: { side: AnchorSide; a: Point; b: Point }[] = [
    { side: 'left', a: { x: box.x, y: box.y }, b: { x: box.x, y: box.y + box.h } },
    { side: 'right', a: { x: box.x + box.w, y: box.y }, b: { x: box.x + box.w, y: box.y + box.h } },
    { side: 'top', a: { x: box.x, y: box.y }, b: { x: box.x + box.w, y: box.y } },
    { side: 'bottom', a: { x: box.x, y: box.y + box.h }, b: { x: box.x + box.w, y: box.y + box.h } }
  ];
  let best: { side: AnchorSide; t: number; dist: number } | null = null;
  edges.forEach(({ side, a, b }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
    t = Math.min(Math.max(t, 0), 1);
    const dist = Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
    if (!best || dist < best.dist) best = { side, t, dist };
  });
  return { side: best!.side, t: best!.t };
}

// Decide which edge of each box the connector attaches to. An explicit
// anchor (dragged there by the user) always wins; otherwise falls back to
// auto left/right based on relative horizontal position, at the given row Y.
// Self-referencing relations (same entity on both ends) default both points
// to the same edge so the curve loops out and back around instead of
// cutting through the box.
function computeEndpoints(aBox: Box, aRowY: number, bBox: Box, bRowY: number, isSelf: boolean, aAnchor?: Anchor, bAnchor?: Anchor): Endpoints {
  if (isSelf) {
    const aPt = aAnchor ? pointOnSide(aBox, aAnchor.side, aAnchor.t) : { x: aBox.x, y: aRowY };
    const bPt = bAnchor ? pointOnSide(bBox, bAnchor.side, bAnchor.t) : { x: bBox.x, y: bRowY };
    return { aPt, bPt, aSide: aAnchor ? aAnchor.side : 'left', bSide: bAnchor ? bAnchor.side : 'left' };
  }
  const aCenterX = aBox.x + aBox.w / 2, bCenterX = bBox.x + bBox.w / 2;
  let autoASide: AnchorSide, autoBSide: AnchorSide;
  if (aCenterX <= bCenterX) { autoASide = 'right'; autoBSide = 'left'; } else { autoASide = 'left'; autoBSide = 'right'; }
  const aSide = aAnchor ? aAnchor.side : autoASide;
  const bSide = bAnchor ? bAnchor.side : autoBSide;
  const aPt = aAnchor ? pointOnSide(aBox, aAnchor.side, aAnchor.t) : { x: autoASide === 'right' ? aBox.x + aBox.w : aBox.x, y: aRowY };
  const bPt = bAnchor ? pointOnSide(bBox, bAnchor.side, bAnchor.t) : { x: autoBSide === 'right' ? bBox.x + bBox.w : bBox.x, y: bRowY };
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

// Crow's foot/one-many markers reach up to ~24px out from the entity edge
// (see cardinalityMarker's distances below). The marker itself is drawn at
// the actual entity edge (geom.aPt/bPt, see updateRelationNode) - this is
// how far past the marker's own reach the curve's bend point sits, so the
// line never bends back through the marker shape. Kept fixed regardless of
// how close two entities are; if that means the two ends overshoot each
// other, the connecting curve just loops back through the middle instead of
// shrinking the reserved space (which would compress/break the marker).
const MARKER_CLEARANCE = 32;

function markerAnchor(edge: Point, side: AnchorSide): Point {
  const dir = sideDir(side);
  return { x: edge.x + dir.x * MARKER_CLEARANCE, y: edge.y + dir.y * MARKER_CLEARANCE };
}

// Endpoint drag handles sit a few px off the entity edge, in the empty
// canvas gap, rather than exactly on it - the entity div overlaps that
// pixel and renders on top of the SVG, so a handle drawn right at the edge
// is partly (or, for a left-attached edge, entirely) unclickable underneath
// the entity's own hit area.
const HANDLE_OFFSET = 9;
function handleAnchor(edge: Point, side: AnchorSide): Point {
  const dir = sideDir(side);
  return { x: edge.x + dir.x * HANDLE_OFFSET, y: edge.y + dir.y * HANDLE_OFFSET };
}

function bezierPath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dirA = sideDir(aSide), dirB = sideDir(bSide);
  const dist = Math.max(Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y) * 0.5, 50);
  const c1 = { x: markerA.x + dirA.x * dist, y: markerA.y + dirA.y * dist };
  const c2 = { x: markerB.x + dirB.x * dist, y: markerB.y + dirB.y * dist };
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: bezierPointAt(markerA, c1, c2, markerB, 0.5)
  };
}

// Right-angle "elbow" routing, generalized to any pair of edges: opposite-
// facing edges (left-right or top-bottom) get a single mid-line between two
// stubs, like before; a horizontal edge paired with a vertical one gets a
// single L-shaped bend at their intersection.
function angularPath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dirA = sideDir(aSide), dirB = sideDir(bSide);
  const dist = Math.max(Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y) * 0.5, 50);
  const stubA = { x: markerA.x + dirA.x * dist, y: markerA.y + dirA.y * dist };
  const stubB = { x: markerB.x + dirB.x * dist, y: markerB.y + dirB.y * dist };
  const aHorizontal = aSide === 'left' || aSide === 'right';
  const bHorizontal = bSide === 'left' || bSide === 'right';

  let bends: Point[];
  let mid: Point;
  if (aHorizontal && bHorizontal) {
    const midX = (stubA.x + stubB.x) / 2;
    bends = [{ x: midX, y: markerA.y }, { x: midX, y: markerB.y }];
    mid = { x: midX, y: (markerA.y + markerB.y) / 2 };
  } else if (!aHorizontal && !bHorizontal) {
    const midY = (stubA.y + stubB.y) / 2;
    bends = [{ x: markerA.x, y: midY }, { x: markerB.x, y: midY }];
    mid = { x: (markerA.x + markerB.x) / 2, y: midY };
  } else {
    const bend = aHorizontal ? { x: markerB.x, y: markerA.y } : { x: markerA.x, y: markerB.y };
    bends = [bend];
    mid = bend;
  }

  const pts = [aPt, markerA, ...bends, markerB, bPt];
  return { d: 'M ' + pts.map((p) => p.x + ' ' + p.y).join(' L '), mid };
}

// Self-referencing (hierarchical) relations attach both ends to the same
// edge, which makes the normal curved/angular routing look wrong - both
// ends push out in the same direction, producing a flattened, kinked shape
// rather than a clean loop. Drawn as an exception: a proper circular arc
// bulging out from the edge, regardless of the current line-style setting.
// Same edge (the default before either end is manually dragged): the two
// markers' outward directions are parallel, which means they're
// diametrically opposite on a circle - a single "bulge in this direction"
// arc is well-defined.
function sameSideLoop(aPt: Point, markerA: Point, bPt: Point, markerB: Point, dir: Point) {
  const chord = Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y);
  const r = Math.max(chord / 2, 40);
  const chordMidX = (markerA.x + markerB.x) / 2, chordMidY = (markerA.y + markerB.y) / 2;
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' A ' + r + ' ' + r + ' 0 1 1 ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: { x: chordMidX + dir.x * r, y: chordMidY + dir.y * r }
  };
}

// Perpendicular sides (e.g. top and left): a single circular arc can only
// match both markers' outward tangent directions exactly when their
// horizontal and vertical offsets from each other happen to be equal - not
// true in general. Rather than chase an exact fit (which can force the arc
// to loop back through the box when it isn't reachable outward), just
// connect the two markers directly with a fixed-radius arc; SVG's arc
// parameterization scales the radius up automatically if it's smaller than
// half the distance between them, so this always renders a single valid
// circular arc regardless of the marker positions.
const PERPENDICULAR_LOOP_RADIUS = 60;
function perpendicularCornerLoop(aPt: Point, markerA: Point, dirA: Point, bPt: Point, markerB: Point, dirB: Point) {
  const cross = dirA.x * dirB.y - dirA.y * dirB.x;
  const sweep = cross > 0 ? 1 : 0;
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' A ' + PERPENDICULAR_LOOP_RADIUS + ' ' + PERPENDICULAR_LOOP_RADIUS + ' 0 0 ' + sweep + ' ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: { x: (markerA.x + markerB.x) / 2, y: (markerA.y + markerB.y) / 2 }
  };
}

function selfLoopPath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dirA = sideDir(aSide), dirB = sideDir(bSide);
  if (aSide === bSide) return sameSideLoop(aPt, markerA, bPt, markerB, dirA);
  const isOpposite = dirA.x === -dirB.x && dirA.y === -dirB.y;
  if (isOpposite) return bezierPath(aPt, aSide, bPt, bSide);
  return perpendicularCornerLoop(aPt, markerA, dirA, bPt, markerB, dirB);
}

function linePath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide, isSelf: boolean) {
  if (isSelf) return selfLoopPath(aPt, aSide, bPt, bSide);
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

function crowFoot(point: Point, side: AnchorSide): SVGGElement {
  // Prongs splay out right at the entity edge and converge to a single
  // point further along the line - like a foot planted against the box.
  const dir = sideDir(side);
  const perp = { x: -dir.y, y: dir.x };
  const forward = { x: point.x + dir.x * 12, y: point.y + dir.y * 12 };
  const g = el('g', { class: 'crowfoot' });
  [-6, 6].forEach((off) => {
    g.appendChild(el('line', {
      x1: point.x + perp.x * off, y1: point.y + perp.y * off, x2: forward.x, y2: forward.y,
      stroke: theme.colors.relationStroke, 'stroke-width': 1.5
    }));
  });
  return g;
}

function bar(point: Point, side: AnchorSide, distance: number): SVGLineElement {
  const dir = sideDir(side);
  const perp = { x: -dir.y, y: dir.x };
  const cx = point.x + dir.x * distance, cy = point.y + dir.y * distance;
  return el('line', {
    x1: cx - perp.x * 6, y1: cy - perp.y * 6, x2: cx + perp.x * 6, y2: cy + perp.y * 6,
    stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

function circle(point: Point, side: AnchorSide, distance: number): SVGCircleElement {
  const dir = sideDir(side);
  return el('circle', {
    cx: point.x + dir.x * distance, cy: point.y + dir.y * distance, r: 4,
    fill: theme.colors.bodyBg, stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

// Crow's foot notation with optionality: the crow's foot (or bars) sit right
// at the entity edge; an outer bar/circle further along the line marks
// mandatory/optional. "many" alone (no outer mark) is also a valid choice.
function cardinalityMarker(point: Point, side: AnchorSide, cardinality: Cardinality): SVGGElement {
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

  const isSelf = relation.sourceEntityId === relation.targetEntityId;
  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y, isSelf, relation.sourceAnchor, relation.targetAnchor);
  const path = linePath(geom.aPt, geom.aSide, geom.bPt, geom.bSide, isSelf);

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
      class: 'relation-handle', 'data-end': 'source', 'data-side': geom.aSide, cx: sourceHandlePt.x, cy: sourceHandlePt.y, r: 6,
      fill: theme.colors.relationStrokeHover, stroke: '#ffffff', 'stroke-width': 2
    }));
    handles.appendChild(el('circle', {
      class: 'relation-handle', 'data-end': 'target', 'data-side': geom.bSide, cx: targetHandlePt.x, cy: targetHandlePt.y, r: 6,
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

function setTempLine(fromPt: Point, fromSide: AnchorSide, toPt: Point, toSide: AnchorSide, isSelf: boolean = false): void {
  tempGroup.style.display = '';
  tempGroup.innerHTML = '';
  const path = linePath(fromPt, fromSide, toPt, toSide, isSelf);
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
  const fixedSide = otherHandle.getAttribute('data-side') as AnchorSide;
  const isSelf = relation.sourceEntityId === relation.targetEntityId;

  let lastAnchor: Anchor | undefined;

  function onMove(ev: MouseEvent): void {
    const world = viewport.screenToWorld(ev.clientX, ev.clientY);
    lastAnchor = nearestAnchor(box!, world);
    setTempLine(fixedPt, fixedSide, pointOnSide(box!, lastAnchor.side, lastAnchor.t), lastAnchor.side, isSelf);
  }
  function onUp(): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearTempLine();
    if (!lastAnchor) return;
    state.updateRelation(relationId, end === 'source' ? { sourceAnchor: lastAnchor } : { targetAnchor: lastAnchor });
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
