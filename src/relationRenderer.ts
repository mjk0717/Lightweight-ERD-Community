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

// Polyline sample points for each connector shape, generated analytically
// alongside the d string. Hop (line-crossing) detection used to re-derive
// these from the DOM via getPointAtLength - which forces the browser to
// re-flatten the whole path on every single call and was, by actual
// profiling, ~90% of the per-mousemove cost when dragging a
// heavily-connected entity. Pure math here is thousands of times cheaper.
function cubicSamples(p0: Point, c1: Point, c2: Point, p3: Point): Point[] {
  // Subdivision count scaled to the control polygon length (an upper bound
  // on arc length) so long sweeping curves keep enough fidelity for
  // crossing detection while short hops stay cheap.
  const approxLen = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p3.x - c2.x, p3.y - c2.y);
  const n = Math.max(16, Math.min(64, Math.ceil(approxLen / 8)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) out.push(bezierPointAt(p0, c1, c2, p3, i / n));
  return out;
}

// SVG endpoint-parameterized circular arc (rotation 0, rx = ry) sampled to
// a polyline - replicates the spec's automatic radius scale-up when the
// requested radius is too small to span the two endpoints.
function arcSamples(p0: Point, p1: Point, r: number, largeArc: boolean, sweep: boolean): Point[] {
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const dSq = dx * dx + dy * dy;
  if (dSq < 1e-9) return [p1];
  let rr = r;
  const lambda = dSq / (rr * rr);
  if (lambda > 1) rr = rr * Math.sqrt(lambda);
  const sign = largeArc !== sweep ? 1 : -1;
  const cc = sign * Math.sqrt(Math.max(0, (rr * rr - dSq) / dSq));
  const cxp = cc * dy, cyp = -cc * dx;
  const cx = cxp + (p0.x + p1.x) / 2, cy = cyp + (p0.y + p1.y) / 2;
  const th0 = Math.atan2(dy - cyp, dx - cxp);
  const th1 = Math.atan2(-dy - cyp, -dx - cxp);
  let dth = th1 - th0;
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  if (sweep && dth < 0) dth += Math.PI * 2;
  const n = Math.max(12, Math.min(64, Math.ceil(Math.abs(dth) * rr / 8)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const th = th0 + dth * (i / n);
    out.push({ x: cx + rr * Math.cos(th), y: cy + rr * Math.sin(th) });
  }
  return out;
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

function pointInBox(p: Point, box: Box, pad: number): boolean {
  return p.x > box.x - pad && p.x < box.x + box.w + pad && p.y > box.y - pad && p.y < box.y + box.h + pad;
}

// Entities are HTML divs stacked above the relation SVG, so any stretch of
// line that sweeps back across its own entity's box just vanishes
// underneath the table. The curve is sampled analytically (pure math, no
// DOM) and rebuilt with progressively longer control arms until its belly
// clears the boxes it's attached to - each retry pushes the bend further
// out, away from the entity. Capped retries: a layout where no arm length
// escapes (heavily overlapping tables) keeps the widest attempt.
function bezierPath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide, avoid?: Box[]) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dirA = sideDir(aSide), dirB = sideDir(bSide);
  const base = Math.max(Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y) * 0.5, 50);
  let c1 = { x: markerA.x + dirA.x * base, y: markerA.y + dirA.y * base };
  let c2 = { x: markerB.x + dirB.x * base, y: markerB.y + dirB.y * base };
  if (avoid && avoid.length) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const dist = base * (1 + attempt * 0.7);
      c1 = { x: markerA.x + dirA.x * dist, y: markerA.y + dirA.y * dist };
      c2 = { x: markerB.x + dirB.x * dist, y: markerB.y + dirB.y * dist };
      let hitsBox = false;
      for (let i = 1; i < 24 && !hitsBox; i++) {
        const p = bezierPointAt(markerA, c1, c2, markerB, i / 24);
        hitsBox = avoid.some((box) => pointInBox(p, box, -1));
      }
      if (!hitsBox) break;
    }
  }
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: bezierPointAt(markerA, c1, c2, markerB, 0.5),
    samples: [aPt, markerA, ...cubicSamples(markerA, c1, c2, markerB), bPt]
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
    // Two horizontal (left/right) anchors. The usual routing drops a single
    // vertical connector at the midpoint x and runs a horizontal stub out of
    // each entity to it. That's clean only when the anchors face TOWARD each
    // other (e.g. A-right sitting left of B-left) so the connector lands in
    // the gap between them. When they're crossed - the same A-right/B-left
    // pair but the tables have been stacked vertically, so A's right marker
    // is now to the right of B's left marker - that vertical connector falls
    // back inside the table bodies and the stubs cut straight through them.
    // In that case route the other way: a horizontal connector at the mid y
    // (the vertical gap between the stacked tables), giving a stepped "ㄹ"
    // path that stays outside both boxes.
    const opposite = dirA.x === -dirB.x;
    const facingToward = dirA.x * (markerB.x - markerA.x) >= 0;
    if (opposite && !facingToward) {
      const midY = (markerA.y + markerB.y) / 2;
      bends = [{ x: markerA.x, y: midY }, { x: markerB.x, y: midY }];
      mid = { x: (markerA.x + markerB.x) / 2, y: midY };
    } else {
      const midX = (stubA.x + stubB.x) / 2;
      bends = [{ x: midX, y: markerA.y }, { x: midX, y: markerB.y }];
      mid = { x: midX, y: (markerA.y + markerB.y) / 2 };
    }
  } else if (!aHorizontal && !bHorizontal) {
    // Mirror of the horizontal case for two vertical (top/bottom) anchors:
    // the usual horizontal mid-connector is clean only when the anchors face
    // toward each other (A-bottom above B-top). When they're crossed - e.g.
    // an up/down relation whose tables are now side by side - that connector
    // folds back through the boxes, so route with a vertical connector in the
    // horizontal gap instead.
    const opposite = dirA.y === -dirB.y;
    const facingToward = dirA.y * (markerB.y - markerA.y) >= 0;
    if (opposite && !facingToward) {
      const midX = (markerA.x + markerB.x) / 2;
      bends = [{ x: midX, y: markerA.y }, { x: midX, y: markerB.y }];
      mid = { x: midX, y: (markerA.y + markerB.y) / 2 };
    } else {
      const midY = (stubA.y + stubB.y) / 2;
      bends = [{ x: markerA.x, y: midY }, { x: markerB.x, y: midY }];
      mid = { x: (markerA.x + markerB.x) / 2, y: midY };
    }
  } else {
    const bend = aHorizontal ? { x: markerB.x, y: markerA.y } : { x: markerA.x, y: markerB.y };
    bends = [bend];
    mid = bend;
  }

  const pts = [aPt, markerA, ...bends, markerB, bPt];
  return { d: 'M ' + pts.map((p) => p.x + ' ' + p.y).join(' L '), mid, samples: pts };
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
    mid: { x: chordMidX + dir.x * r, y: chordMidY + dir.y * r },
    samples: [aPt, markerA, ...arcSamples(markerA, markerB, r, true, true), bPt]
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
    mid: { x: (markerA.x + markerB.x) / 2, y: (markerA.y + markerB.y) / 2 },
    samples: [aPt, markerA, ...arcSamples(markerA, markerB, PERPENDICULAR_LOOP_RADIUS, false, sweep === 1), bPt]
  };
}

// Opposite edges of the SAME entity (both ends dragged to, say, left and
// right): a plain bezier between them runs straight through the middle of
// the box - and no amount of control-arm stretching gets it out, since the
// two arms point away from each other horizontally. Routed explicitly
// around the box instead: over the top for horizontal edge pairs, around
// the left for vertical ones.
const SELF_DETOUR_CLEARANCE = 50;
function oppositeSideSelfLoop(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide, box: Box) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const horizontal = aSide === 'left' || aSide === 'right';
  const c1 = horizontal
    ? { x: markerA.x, y: box.y - SELF_DETOUR_CLEARANCE }
    : { x: box.x - SELF_DETOUR_CLEARANCE, y: markerA.y };
  const c2 = horizontal
    ? { x: markerB.x, y: box.y - SELF_DETOUR_CLEARANCE }
    : { x: box.x - SELF_DETOUR_CLEARANCE, y: markerB.y };
  return {
    d: 'M ' + aPt.x + ' ' + aPt.y +
      ' L ' + markerA.x + ' ' + markerA.y +
      ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + markerB.x + ' ' + markerB.y +
      ' L ' + bPt.x + ' ' + bPt.y,
    mid: bezierPointAt(markerA, c1, c2, markerB, 0.5),
    samples: [aPt, markerA, ...cubicSamples(markerA, c1, c2, markerB), bPt]
  };
}

function selfLoopPath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide, box?: Box) {
  const markerA = markerAnchor(aPt, aSide);
  const markerB = markerAnchor(bPt, bSide);
  const dirA = sideDir(aSide), dirB = sideDir(bSide);
  if (aSide === bSide) return sameSideLoop(aPt, markerA, bPt, markerB, dirA);
  const isOpposite = dirA.x === -dirB.x && dirA.y === -dirB.y;
  if (isOpposite) {
    if (box) return oppositeSideSelfLoop(aPt, aSide, bPt, bSide, box);
    return bezierPath(aPt, aSide, bPt, bSide);
  }
  return perpendicularCornerLoop(aPt, markerA, dirA, bPt, markerB, dirB);
}

function linePath(aPt: Point, aSide: AnchorSide, bPt: Point, bSide: AnchorSide, isSelf: boolean, avoid?: Box[]) {
  if (isSelf) return selfLoopPath(aPt, aSide, bPt, bSide, avoid && avoid[0]);
  return state.data.lineStyle === 'angular' ? angularPath(aPt, aSide, bPt, bSide) : bezierPath(aPt, aSide, bPt, bSide, avoid);
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
  [-8, 8].forEach((off) => {
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
    x1: cx - perp.x * 8, y1: cy - perp.y * 8, x2: cx + perp.x * 8, y2: cy + perp.y * 8,
    stroke: theme.colors.relationStroke, 'stroke-width': 1.5
  });
}

function circle(point: Point, side: AnchorSide, distance: number): SVGCircleElement {
  const dir = sideDir(side);
  return el('circle', {
    cx: point.x + dir.x * distance, cy: point.y + dir.y * distance, r: 6,
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

// Everything a relation node's DOM actually depends on. Rebuilding the
// node's markers/label/line on every render is what made dragging a
// heavily-connected entity lag - each mousemove re-created every
// relation's marker elements and re-measured every label, even for
// relations nowhere near the moved entity. With the signature check, a
// render only touches the nodes whose geometry or styling actually changed.
function relationNodeSignature(relation: Relation, pathD: string, isSelected: boolean, identifying: boolean): string {
  return pathD + '|' + isSelected + '|' + identifying + '|' + displayRelationName(relation) + '|' +
    sourceCardinalityOf(relation) + '|' + targetCardinalityOf(relation);
}

function updateRelationNode(node: SVGGElement, relation: Relation): void {
  const aBox = entityRenderer.getEntityBox(relation.sourceEntityId);
  const bBox = entityRenderer.getEntityBox(relation.targetEntityId);
  if (!aBox || !bBox) { node.style.display = 'none'; delete node.dataset.sig; relationSamples.delete(relation.id); return; }
  node.style.display = '';
  // A composite (multi-column) FK still draws as a single line - anchored
  // on the first column pair's rows.
  const firstPair = relation.columnPairs[0];
  if (!firstPair) { node.style.display = 'none'; delete node.dataset.sig; relationSamples.delete(relation.id); return; }
  const aRow = entityRenderer.getColumnRowCenter(relation.sourceEntityId, firstPair.sourceColumnId);
  const bRow = entityRenderer.getColumnRowCenter(relation.targetEntityId, firstPair.targetColumnId);
  if (!aRow || !bRow) { node.style.display = 'none'; delete node.dataset.sig; relationSamples.delete(relation.id); return; }

  const isSelf = relation.sourceEntityId === relation.targetEntityId;
  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y, isSelf, relation.sourceAnchor, relation.targetAnchor);
  const path = linePath(geom.aPt, geom.aSide, geom.bPt, geom.bSide, isSelf, isSelf ? [aBox] : [aBox, bBox]);
  relationSamples.set(relation.id, path.samples);

  const selected = state.data.selected;
  const isSelected = !!(selected && selected.type === 'relation' && selected.id === relation.id);
  const identifying = isIdentifying(relation);

  const sig = relationNodeSignature(relation, path.d, isSelected, identifying);
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;

  const line = node.querySelector('.relation-line') as SVGPathElement;
  line.setAttribute('d', path.d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', isSelected ? theme.colors.relationStrokeHover : theme.colors.relationStroke);
  line.setAttribute('stroke-width', isSelected ? '2.5' : '1.5');
  if (identifying) line.removeAttribute('stroke-dasharray');
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

// ---------- line-crossing hops ----------
// Where two different relations' lines actually cross (not just meet at a
// shared entity edge), the line reads as ambiguous - is that an X or a
// junction? Standard schematic convention: give one of the two lines a
// small semicircular "hop" over the crossing point so it visually reads as
// passing over/under rather than connecting. Detection works on a dense
// polyline sample of each relation's already-computed path (getPointAtLength
// handles bezier/angular/arc paths uniformly, so this needs no path-type-
// specific math) - only relations that actually have a crossing get their
// visible line rebuilt from that polyline; everything else keeps its
// original smooth curve untouched.
const HOP_RADIUS = 7;

function vSub(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }
function vAdd(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y }; }
function vScale(a: Point, k: number): Point { return { x: a.x * k, y: a.y * k }; }
function vNorm(a: Point): Point { const len = Math.hypot(a.x, a.y) || 1; return { x: a.x / len, y: a.y / len }; }

// Analytic polyline of each relation's current path, stored by
// updateRelationNode as a byproduct of building the path. This is the sole
// geometry source for hop detection - never re-derived from the DOM.
const relationSamples = new Map<string, Point[]>();

function bboxOf(points: Point[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function bboxesOverlap(a: Box, b: Box, pad: number): boolean {
  return a.x - pad <= b.x + b.w + pad && b.x - pad <= a.x + a.w + pad &&
    a.y - pad <= b.y + b.h + pad && b.y - pad <= a.y + a.h + pad;
}

// Interior crossing of two segments. The bounds are strict [0,1] with only a
// hair of epsilon slack - NOT a wide per-segment margin: a wide margin
// (e.g. rejecting the outer 3% of every segment) punches a blind spot at
// each shared polyline vertex, since a crossing landing on a vertex reads as
// t~=0.98 on one segment and t~=0.02 on the next, so BOTH adjacent segments
// reject it and the crossing gets no hop. Endpoint-touch exclusion (lines
// merely meeting at a shared entity edge) is handled separately and more
// precisely by the MIN_EDGE_DISTANCE filter in computeLineCrossingHops; a
// crossing exactly on a vertex may match both adjacent segments here, but
// dedupeCrossings collapses that duplicate.
function segIntersection(p1: Point, p2: Point, p3: Point, p4: Point): { t: number; point: Point } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  const EPS = 1e-6;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, point: { x: p1.x + t * d1x, y: p1.y + t * d1y } };
}

interface Crossing { segIndex: number; t: number; point: Point; otherId: string }

interface CrossingEntry { id: string; points: Point[]; identifying: boolean }

// A crossing this close to either line's own entity edge falls inside (or
// right next to) that edge's cardinality marker artwork - hopping there
// reads as visual clutter on top of the marker rather than a clean jump, so
// it's better left as a plain (if slightly overlapping) line than "fixed"
// with a hop that just adds more mess right where the marker already is.
const MIN_EDGE_DISTANCE = MARKER_CLEARANCE + HOP_RADIUS;

function distanceToNearestEndpoint(pt: Point, points: Point[]): number {
  const first = points[0], last = points[points.length - 1];
  return Math.min(Math.hypot(pt.x - first.x, pt.y - first.y), Math.hypot(pt.x - last.x, pt.y - last.y));
}

// Two curves that run close and nearly parallel for a stretch (rather than
// crossing cleanly once) get flagged on several adjacent sample segments in
// a row instead of one - collapsing anything within this distance of the
// previously accepted crossing (against that SAME other relation) turns
// that cluster back into a single hop. Grouped by otherId first so this
// never merges two genuinely different crossings (e.g. against two
// different relations meeting near the same spot, as in a hub layout) into
// one, which would silently drop a real crossing's hop.
const MIN_CROSSING_GAP = HOP_RADIUS * 3;

function dedupeCrossings(crossings: Crossing[]): Crossing[] {
  const byOther = new Map<string, Crossing[]>();
  crossings.forEach((c) => {
    const list = byOther.get(c.otherId) || [];
    list.push(c);
    byOther.set(c.otherId, list);
  });
  const out: Crossing[] = [];
  byOther.forEach((list) => {
    const sorted = list.slice().sort((a, b) => (a.segIndex + a.t) - (b.segIndex + b.t));
    let prev: Crossing | undefined;
    sorted.forEach((c) => {
      if (prev && Math.hypot(c.point.x - prev.point.x, c.point.y - prev.point.y) < MIN_CROSSING_GAP) return;
      out.push(c);
      prev = c;
    });
  });
  return out;
}

// Which of a crossing pair gets the hop: non-identifying (dashed)
// relations yield before identifying (solid) ones - solid lines are meant
// to read as the more "structural" connection and stay straight wherever
// possible - and within the same identifying-ness, the lexicographically
// smaller id yields, so the choice is stable across re-renders regardless
// of draw order.
function isPreferredYielder(a: CrossingEntry, b: CrossingEntry): boolean {
  if (a.identifying !== b.identifying) return !a.identifying;
  return a.id < b.id;
}

function computeLineCrossingHops(entries: CrossingEntry[]): Map<string, Crossing[]> {
  const hopsByRelation = new Map<string, Crossing[]>();
  const boxes = entries.map((e) => bboxOf(e.points));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].id === entries[j].id) continue;
      if (!bboxesOverlap(boxes[i], boxes[j], HOP_RADIUS)) continue;
      const yielderIdx = isPreferredYielder(entries[i], entries[j]) ? i : j;
      const otherIdx = yielderIdx === i ? j : i;
      const yielder = entries[yielderIdx], other = entries[otherIdx];
      for (let si = 0; si < yielder.points.length - 1; si++) {
        for (let sj = 0; sj < other.points.length - 1; sj++) {
          const hit = segIntersection(yielder.points[si], yielder.points[si + 1], other.points[sj], other.points[sj + 1]);
          if (!hit) continue;
          if (distanceToNearestEndpoint(hit.point, yielder.points) < MIN_EDGE_DISTANCE) continue;
          if (distanceToNearestEndpoint(hit.point, other.points) < MIN_EDGE_DISTANCE) continue;
          const list = hopsByRelation.get(yielder.id) || [];
          list.push({ segIndex: si, t: hit.t, point: hit.point, otherId: other.id });
          hopsByRelation.set(yielder.id, list);
        }
      }
    }
  }
  hopsByRelation.forEach((list, id) => hopsByRelation.set(id, dedupeCrossings(list)));
  return hopsByRelation;
}

// Cumulative arc length at each sample point, so a crossing's exact
// position (segIndex + t, i.e. a fraction of the way through one ~6px
// sample segment) can be converted to a precise distance-along-the-curve
// figure instead of only ever landing on a sample point.
function cumulativeLengths(points: Point[]): number[] {
  const cum = [0];
  for (let k = 1; k < points.length; k++) cum.push(cum[k - 1] + Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y));
  return cum;
}

// The point at a given arc length along the polyline, interpolated between
// whichever two sample points straddle it - this is what makes the hop's
// before/after anchors land exactly HOP_RADIUS from the true crossing point
// rather than snapping to the nearest ~6px sample, which is what made hops
// visibly off-center whenever the crossing fell close to one end of its
// sample segment instead of the middle.
function pointAtArcLength(points: Point[], cum: number[], targetLen: number): Point {
  const clamped = Math.max(0, Math.min(cum[cum.length - 1], targetLen));
  for (let k = 0; k < points.length - 1; k++) {
    if (cum[k + 1] >= clamped) {
      const segLen = cum[k + 1] - cum[k];
      const frac = segLen === 0 ? 0 : (clamped - cum[k]) / segLen;
      return vAdd(points[k], vScale(vSub(points[k + 1], points[k]), frac));
    }
  }
  return points[points.length - 1];
}

// Rebuilds the polyline as straight segments, replacing a HOP_RADIUS-wide
// window around each crossing's exact arc-length position with a
// quadratic-bezier bump - walked in arc-length order (not by sample index)
// so overlapping/adjacent crossing windows chain together cleanly instead
// of one silently overwriting or skipping past another. The bump's control
// point is placed so the curve's midpoint sits out from the chord on
// whichever perpendicular points further up-screen - always bulges "up"
// rather than alternating with travel direction.
function buildHopPath(points: Point[], crossings: Crossing[]): string {
  if (!points.length) return '';
  if (!crossings.length) return 'M ' + points.map((p) => p.x + ' ' + p.y).join(' L ');

  const cum = cumulativeLengths(points);
  const sorted = crossings
    .map((c) => ({ c, arc: cum[c.segIndex] + c.t * (cum[c.segIndex + 1] - cum[c.segIndex]) }))
    .sort((a, b) => a.arc - b.arc);

  let d = 'M ' + points[0].x + ' ' + points[0].y;
  let k = 1; // next raw sample point not yet emitted
  let emittedArc = 0;

  sorted.forEach(({ arc }) => {
    const beforeArc = Math.max(emittedArc, arc - HOP_RADIUS);
    const afterArc = arc + HOP_RADIUS;
    while (k < points.length && cum[k] < beforeArc) {
      d += ' L ' + points[k].x + ' ' + points[k].y;
      k++;
    }
    const before = pointAtArcLength(points, cum, beforeArc);
    const after = pointAtArcLength(points, cum, afterArc);
    d += ' L ' + before.x + ' ' + before.y;

    const dir = vNorm(vSub(after, before));
    const mid = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 };
    const perpA: Point = { x: -dir.y, y: dir.x };
    const perpB: Point = { x: dir.y, y: -dir.x };
    const perp = perpA.y <= perpB.y ? perpA : perpB;
    const bumpHeight = Math.max(HOP_RADIUS, Math.hypot(after.x - before.x, after.y - before.y) / 2);
    const control = vAdd(mid, vScale(perp, bumpHeight * 2));
    d += ' Q ' + control.x + ' ' + control.y + ', ' + after.x + ' ' + after.y;

    emittedArc = afterArc;
    while (k < points.length && cum[k] <= afterArc) k++;
  });

  while (k < points.length) { d += ' L ' + points[k].x + ' ' + points[k].y; k++; }

  return d;
}

// Relations whose visible line currently carries hop bumps - needed so a
// hop can be REMOVED again: with the signature check, updateRelationNode
// skips a relation whose own geometry didn't change, so when the line it
// used to cross moves away, restoring the base (hop-free) path is this
// function's job, not updateRelationNode's. The hit path always holds the
// base d.
const hoppedIds = new Set<string>();

function applyLineCrossingHops(): void {
  const entries: (CrossingEntry & { line: SVGPathElement; baseD: string })[] = [];
  nodeMap.forEach((node, id) => {
    if (node.style.display === 'none') return;
    const relation = state.getRelation(id);
    if (!relation) return;
    const points = relationSamples.get(id);
    if (!points || points.length < 2) return;
    const hit = node.querySelector('.relation-hit') as SVGPathElement;
    const line = node.querySelector('.relation-line') as SVGPathElement;
    entries.push({ id, points, line, baseD: hit.getAttribute('d') || '', identifying: isIdentifying(relation) });
  });

  const hopsByRelation = computeLineCrossingHops(entries);
  entries.forEach((entry) => {
    const crossings = hopsByRelation.get(entry.id);
    if (crossings && crossings.length) {
      entry.line.setAttribute('d', buildHopPath(entry.points, crossings));
      hoppedIds.add(entry.id);
    } else if (hoppedIds.has(entry.id)) {
      entry.line.setAttribute('d', entry.baseD);
      hoppedIds.delete(entry.id);
    }
  });
}

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
    if (!seen.has(id)) { node.remove(); nodeMap.delete(id); relationSamples.delete(id); hoppedIds.delete(id); }
  });
  applyLineCrossingHops();
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
