import { state } from './state';
import { theme } from './theme';
import { downloadDataUrl } from './util';
import { entityRenderer } from './entityRenderer';
import { sourceCardinalityOf, targetCardinalityOf } from './cardinality';
import { Anchor, AnchorSide, Box, Cardinality, Column, Entity, Point, Relation } from './types';

const MARGIN = 50;
const PIXEL_RATIO = 2;

function rowBackground(col: Column, idx: number): string {
  if (col.isSystem) return theme.colors.systemBg;
  if (col.pk) return theme.colors.pkBg;
  if (idx % 2 === 1) return theme.colors.rowAlt;
  return theme.colors.bodyBg;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

function bounds(): Bounds | null {
  const entities = state.data.entities;
  if (!entities.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  entities.forEach((e) => {
    const box = entityRenderer.getEntityBox(e.id)!;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  });
  return { minX: minX - MARGIN, minY: minY - MARGIN, maxX: maxX + MARGIN, maxY: maxY + MARGIN };
}

function bezierPointAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

interface Endpoints { aPt: Point; bPt: Point; aSide: AnchorSide; bSide: AnchorSide; }

// See relationRenderer.ts for the canonical versions of these - mirrored
// here so the PNG export matches the on-screen rendering exactly.
function sideDir(side: AnchorSide): Point {
  switch (side) {
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
  }
}

function pointOnSide(box: Box, side: AnchorSide, t: number): Point {
  switch (side) {
    case 'left': return { x: box.x, y: box.y + box.h * t };
    case 'right': return { x: box.x + box.w, y: box.y + box.h * t };
    case 'top': return { x: box.x + box.w * t, y: box.y };
    case 'bottom': return { x: box.x + box.w * t, y: box.y + box.h };
  }
}

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

const MARKER_CLEARANCE = 32;

function markerAnchor(edge: Point, side: AnchorSide): Point {
  const dir = sideDir(side);
  return { x: edge.x + dir.x * MARKER_CLEARANCE, y: edge.y + dir.y * MARKER_CLEARANCE };
}

function drawCrowFoot(ctx: CanvasRenderingContext2D, point: Point, side: AnchorSide): void {
  // Prongs splay out right at the entity edge and converge to a single
  // point further along the line - like a foot planted against the box.
  const dir = sideDir(side);
  const perp = { x: -dir.y, y: dir.x };
  const forward = { x: point.x + dir.x * 12, y: point.y + dir.y * 12 };
  [-8, 8].forEach((off) => {
    ctx.beginPath();
    ctx.moveTo(point.x + perp.x * off, point.y + perp.y * off);
    ctx.lineTo(forward.x, forward.y);
    ctx.stroke();
  });
}

function drawBar(ctx: CanvasRenderingContext2D, point: Point, side: AnchorSide, distance: number): void {
  const dir = sideDir(side);
  const perp = { x: -dir.y, y: dir.x };
  const cx = point.x + dir.x * distance, cy = point.y + dir.y * distance;
  ctx.beginPath();
  ctx.moveTo(cx - perp.x * 8, cy - perp.y * 8);
  ctx.lineTo(cx + perp.x * 8, cy + perp.y * 8);
  ctx.stroke();
}

function drawCircle(ctx: CanvasRenderingContext2D, point: Point, side: AnchorSide, distance: number): void {
  const dir = sideDir(side);
  ctx.beginPath();
  ctx.arc(point.x + dir.x * distance, point.y + dir.y * distance, 6, 0, Math.PI * 2);
  ctx.fillStyle = theme.colors.bodyBg;
  ctx.fill();
  ctx.stroke();
}

function drawCardinalityMarker(ctx: CanvasRenderingContext2D, point: Point, side: AnchorSide, cardinality: Cardinality): void {
  switch (cardinality) {
    case 'one':
      drawBar(ctx, point, side, 9);
      drawBar(ctx, point, side, 15);
      break;
    case 'zero-or-one':
      drawBar(ctx, point, side, 9);
      drawCircle(ctx, point, side, 17);
      break;
    case 'zero-or-many':
      // Crow's foot converges at 12; circle (radius 4) centered at 16 so its
      // near edge touches the foot's tip instead of floating past it.
      drawCrowFoot(ctx, point, side);
      drawCircle(ctx, point, side, 16);
      break;
    case 'one-or-many':
      // Bar sits right at the foot's convergence point, capping it.
      drawCrowFoot(ctx, point, side);
      drawBar(ctx, point, side, 12);
      break;
    case 'many':
    default:
      drawCrowFoot(ctx, point, side);
      break;
  }
}

// Identifying relationship (FK column also part of the child's PK) draws
// solid; a plain attribute FK (non-identifying) draws dashed.
function isIdentifying(relation: Relation): boolean {
  return relation.columnPairs.every((p) => {
    const col = state.getColumn(relation.sourceEntityId, p.sourceColumnId);
    return !!col && col.pk;
  });
}

function drawRelation(ctx: CanvasRenderingContext2D, relation: Relation): void {
  const aBox = entityRenderer.getEntityBox(relation.sourceEntityId);
  const bBox = entityRenderer.getEntityBox(relation.targetEntityId);
  if (!aBox || !bBox) return;
  // A composite (multi-column) FK still draws as a single line - anchored
  // on the first column pair's rows.
  const firstPair = relation.columnPairs[0];
  if (!firstPair) return;
  const aRow = entityRenderer.getColumnRowCenter(relation.sourceEntityId, firstPair.sourceColumnId);
  const bRow = entityRenderer.getColumnRowCenter(relation.targetEntityId, firstPair.targetColumnId);
  if (!aRow || !bRow) return;

  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y, relation.sourceEntityId === relation.targetEntityId, relation.sourceAnchor, relation.targetAnchor);
  const markerA = markerAnchor(geom.aPt, geom.aSide);
  const markerB = markerAnchor(geom.bPt, geom.bSide);
  const dirA = sideDir(geom.aSide), dirB = sideDir(geom.bSide);
  const dist = Math.max(Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y) * 0.5, 50);

  ctx.strokeStyle = theme.colors.relationStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(isIdentifying(relation) ? [] : [6, 4]);
  ctx.beginPath();
  ctx.moveTo(geom.aPt.x, geom.aPt.y);
  ctx.lineTo(markerA.x, markerA.y);

  // Self-referencing relations attach both ends to the same entity -
  // circular-arc treatments instead of the normal routing (which would
  // otherwise look kinked or push both ends the same direction). See
  // relationRenderer.ts's selfLoopPath for the on-screen counterpart.
  const isSelf = relation.sourceEntityId === relation.targetEntityId;
  const isOpposite = dirA.x === -dirB.x && dirA.y === -dirB.y;
  const arcMidAngle = (from: number, to: number, ccw: boolean): number => {
    let e = to;
    if (!ccw) { while (e < from) e += Math.PI * 2; } else { while (e > from) e -= Math.PI * 2; }
    return (from + e) / 2;
  };
  const angleDist = (a: number, b: number): number => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(d, Math.PI * 2 - d);
  };
  let mid: Point;
  if (isSelf && geom.aSide === geom.bSide) {
    // Same edge: the two markers' outward directions are parallel, i.e.
    // diametrically opposite on a circle - a single "bulge in this
    // direction" arc is well-defined.
    const chord = Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y);
    const r = Math.max(chord / 2, 40);
    const chordMidX = (markerA.x + markerB.x) / 2, chordMidY = (markerA.y + markerB.y) / 2;
    const centerOffset = Math.sqrt(Math.max(r * r - (chord / 2) * (chord / 2), 0));
    const center = { x: chordMidX + dirA.x * centerOffset, y: chordMidY + dirA.y * centerOffset };
    const farPoint = { x: chordMidX + dirA.x * r, y: chordMidY + dirA.y * r };
    const startAngle = Math.atan2(markerA.y - center.y, markerA.x - center.x);
    const endAngle = Math.atan2(markerB.y - center.y, markerB.x - center.x);
    const farAngle = Math.atan2(farPoint.y - center.y, farPoint.x - center.x);
    const useCcw = angleDist(arcMidAngle(startAngle, endAngle, true), farAngle) < angleDist(arcMidAngle(startAngle, endAngle, false), farAngle);
    ctx.arc(center.x, center.y, r, startAngle, endAngle, useCcw);
    mid = farPoint;
  } else if (isSelf && !isOpposite) {
    // Perpendicular sides (e.g. top and left): a single arc can only match
    // both markers' exact outward tangents when their horizontal/vertical
    // offsets happen to be equal, which isn't true in general - rather than
    // chase an exact fit, just connect the two markers directly with a
    // fixed-radius arc (scaled up automatically if that radius is smaller
    // than half the distance between them), picking whichever of the two
    // possible arcs bulges further from the entity's own box.
    const FIXED_R = 60;
    const chord = Math.hypot(markerB.x - markerA.x, markerB.y - markerA.y);
    const r = Math.max(FIXED_R, chord / 2);
    const chordMidX = (markerA.x + markerB.x) / 2, chordMidY = (markerA.y + markerB.y) / 2;
    const centerOffset = Math.sqrt(Math.max(r * r - (chord / 2) * (chord / 2), 0));
    const chordDirX = (markerB.x - markerA.x) / chord, chordDirY = (markerB.y - markerA.y) / chord;
    const perpX = -chordDirY, perpY = chordDirX;
    const center1 = { x: chordMidX + perpX * centerOffset, y: chordMidY + perpY * centerOffset };
    const center2 = { x: chordMidX - perpX * centerOffset, y: chordMidY - perpY * centerOffset };
    const boxCenter = { x: aBox.x + aBox.w / 2, y: aBox.y + aBox.h / 2 };
    const center = Math.hypot(center1.x - boxCenter.x, center1.y - boxCenter.y) < Math.hypot(center2.x - boxCenter.x, center2.y - boxCenter.y) ? center1 : center2;
    const startAngle = Math.atan2(markerA.y - center.y, markerA.x - center.x);
    const endAngle = Math.atan2(markerB.y - center.y, markerB.x - center.x);
    const midCcw = { a: arcMidAngle(startAngle, endAngle, true) }, midCw = { a: arcMidAngle(startAngle, endAngle, false) };
    const pCcw = { x: center.x + r * Math.cos(midCcw.a), y: center.y + r * Math.sin(midCcw.a) };
    const pCw = { x: center.x + r * Math.cos(midCw.a), y: center.y + r * Math.sin(midCw.a) };
    const useCcw = Math.hypot(pCcw.x - boxCenter.x, pCcw.y - boxCenter.y) > Math.hypot(pCw.x - boxCenter.x, pCw.y - boxCenter.y);
    ctx.arc(center.x, center.y, r, startAngle, endAngle, useCcw);
    mid = { x: (markerA.x + markerB.x) / 2, y: (markerA.y + markerB.y) / 2 };
  } else if (state.data.lineStyle === 'angular') {
    const stubA = { x: markerA.x + dirA.x * dist, y: markerA.y + dirA.y * dist };
    const stubB = { x: markerB.x + dirB.x * dist, y: markerB.y + dirB.y * dist };
    const aHorizontal = geom.aSide === 'left' || geom.aSide === 'right';
    const bHorizontal = geom.bSide === 'left' || geom.bSide === 'right';
    if (aHorizontal && bHorizontal) {
      const midX = (stubA.x + stubB.x) / 2;
      ctx.lineTo(midX, markerA.y);
      ctx.lineTo(midX, markerB.y);
      mid = { x: midX, y: (markerA.y + markerB.y) / 2 };
    } else if (!aHorizontal && !bHorizontal) {
      const midY = (stubA.y + stubB.y) / 2;
      ctx.lineTo(markerA.x, midY);
      ctx.lineTo(markerB.x, midY);
      mid = { x: (markerA.x + markerB.x) / 2, y: midY };
    } else {
      const bend = aHorizontal ? { x: markerB.x, y: markerA.y } : { x: markerA.x, y: markerB.y };
      ctx.lineTo(bend.x, bend.y);
      mid = bend;
    }
    ctx.lineTo(markerB.x, markerB.y);
  } else {
    const c1 = { x: markerA.x + dirA.x * dist, y: markerA.y + dirA.y * dist };
    const c2 = { x: markerB.x + dirB.x * dist, y: markerB.y + dirB.y * dist };
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, markerB.x, markerB.y);
    mid = bezierPointAt(markerA, c1, c2, markerB, 0.5);
  }
  ctx.lineTo(geom.bPt.x, geom.bPt.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Markers sit right at the entity edge; markerA/markerB (used above for
  // the curve's bend point) is what reserves the clearance past the marker.
  drawCardinalityMarker(ctx, geom.aPt, geom.aSide, sourceCardinalityOf(relation));
  drawCardinalityMarker(ctx, geom.bPt, geom.bSide, targetCardinalityOf(relation));

  const labelText = state.data.designMode === 'logical' && relation.logicalName ? relation.logicalName : relation.name;
  if (labelText) {
    ctx.font = '11px ' + theme.fontFamily;
    const textWidth = ctx.measureText(labelText).width;
    ctx.fillStyle = theme.colors.relationLabelBg;
    ctx.fillRect(mid.x - textWidth / 2 - 4, mid.y - 10, textWidth + 8, 16);
    ctx.fillStyle = theme.colors.text;
    ctx.textAlign = 'center';
    ctx.fillText(labelText, mid.x, mid.y + 2);
    ctx.textAlign = 'left';
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, entity: Entity): void {
  const box = entityRenderer.getEntityBox(entity.id)!;
  ctx.fillStyle = entity.headerColor || theme.colors.headerBg;
  ctx.fillRect(box.x, box.y, box.w, theme.headerHeight);
  ctx.fillStyle = theme.colors.headerText;
  ctx.font = 'bold 13px ' + theme.fontFamily;
  ctx.textBaseline = 'middle';
  ctx.fillText(entityRenderer.displayName(entity), box.x + 8, box.y + theme.headerHeight / 2 + 1, box.w - 16);

  entity.columns.forEach((col, idx) => {
    const rowY = box.y + theme.headerHeight + idx * theme.rowHeight;
    ctx.fillStyle = rowBackground(col, idx);
    ctx.fillRect(box.x, rowY, box.w, theme.rowHeight);

    const flag = col.isSystem ? 'S' : (col.pk && col.fk ? 'P/F' : (col.pk ? 'PK' : (col.fk ? 'FK' : '')));
    if (flag) {
      ctx.font = 'bold 10px ' + theme.fontFamily;
      ctx.fillStyle = theme.colors.subtext;
      ctx.fillText(flag, box.x + 6, rowY + theme.rowHeight / 2 + 1);
    }
    ctx.font = '12px ' + theme.fontFamily;
    ctx.fillStyle = col.isSystem ? theme.colors.systemText : theme.colors.text;
    ctx.fillText(entityRenderer.displayColumnName(col), box.x + 30, rowY + theme.rowHeight / 2 + 1, box.w - 100);

    ctx.font = '11px ' + theme.fontFamily;
    ctx.fillStyle = theme.colors.subtext;
    ctx.textAlign = 'right';
    ctx.fillText(col.dataType + (col.nullable ? '' : ' *'), box.x + box.w - 6, rowY + theme.rowHeight / 2 + 1, 90);
    ctx.textAlign = 'left';
  });

  ctx.strokeStyle = theme.colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
}

// Renders the whole diagram to a PNG data URL (null if there's nothing to
// draw). Split out from exportPng so the Export wizard can show a preview
// before the user commits to downloading.
function renderDataUrl(): string | null {
  const b = bounds();
  if (!b) return null;

  const width = b.maxX - b.minX, height = b.maxY - b.minY;
  const canvas = document.createElement('canvas');
  canvas.width = width * PIXEL_RATIO;
  canvas.height = height * PIXEL_RATIO;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  ctx.translate(-b.minX, -b.minY);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(b.minX, b.minY, width, height);

  state.data.relations.forEach((r) => drawRelation(ctx, r));
  state.data.entities.forEach((e) => drawEntity(ctx, e));

  return canvas.toDataURL('image/png');
}

function exportPng(): void {
  const url = renderDataUrl();
  if (!url) { window.alert('Nothing to export - add a table first.'); return; }
  downloadDataUrl(url, 'erd-diagram.png');
}

export const pngExport = { exportPng, renderDataUrl };
