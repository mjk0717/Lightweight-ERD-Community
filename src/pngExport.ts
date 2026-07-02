import { state } from './state';
import { theme } from './theme';
import { downloadDataUrl } from './util';
import { entityRenderer } from './entityRenderer';
import { sourceCardinalityOf, targetCardinalityOf } from './cardinality';
import { Box, Cardinality, Column, Entity, Point, Relation } from './types';

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

interface Endpoints { aPt: Point; bPt: Point; aSide: 'left' | 'right'; bSide: 'left' | 'right'; }

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

// See relationRenderer.ts's markerAnchor - mirrors the same fixed-clearance
// logic so the PNG export matches the on-screen rendering.
const MARKER_CLEARANCE = 32;

function markerAnchor(edge: Point, side: 'left' | 'right'): Point {
  const dir = side === 'right' ? 1 : -1;
  return { x: edge.x + dir * MARKER_CLEARANCE, y: edge.y };
}

function drawCrowFoot(ctx: CanvasRenderingContext2D, point: Point, side: 'left' | 'right'): void {
  // Prongs splay out right at the entity edge and converge to a single
  // point further along the line - like a foot planted against the box.
  const dir = side === 'right' ? 1 : -1;
  const forward = { x: point.x + dir * 12, y: point.y };
  [-6, 6].forEach((off) => {
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + off);
    ctx.lineTo(forward.x, forward.y);
    ctx.stroke();
  });
}

function drawBar(ctx: CanvasRenderingContext2D, point: Point, side: 'left' | 'right', distance: number): void {
  const dir = side === 'right' ? 1 : -1;
  const x = point.x + dir * distance;
  ctx.beginPath();
  ctx.moveTo(x, point.y - 6);
  ctx.lineTo(x, point.y + 6);
  ctx.stroke();
}

function drawCircle(ctx: CanvasRenderingContext2D, point: Point, side: 'left' | 'right', distance: number): void {
  const dir = side === 'right' ? 1 : -1;
  ctx.beginPath();
  ctx.arc(point.x + dir * distance, point.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = theme.colors.bodyBg;
  ctx.fill();
  ctx.stroke();
}

function drawCardinalityMarker(ctx: CanvasRenderingContext2D, point: Point, side: 'left' | 'right', cardinality: Cardinality): void {
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

  const aRowY = relation.sourceAnchorT === undefined ? aRow.y : aBox.y + aBox.h * relation.sourceAnchorT;
  const bRowY = relation.targetAnchorT === undefined ? bRow.y : bBox.y + bBox.h * relation.targetAnchorT;
  const geom = computeEndpoints(aBox, aRowY, bBox, bRowY, relation.sourceEntityId === relation.targetEntityId);
  const markerA = markerAnchor(geom.aPt, geom.aSide);
  const markerB = markerAnchor(geom.bPt, geom.bSide);
  const dx = Math.max(Math.abs(markerB.x - markerA.x) * 0.5, 50);

  ctx.strokeStyle = theme.colors.relationStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(isIdentifying(relation) ? [] : [6, 4]);
  ctx.beginPath();
  ctx.moveTo(geom.aPt.x, geom.aPt.y);
  ctx.lineTo(markerA.x, markerA.y);

  let mid: Point;
  if (state.data.lineStyle === 'angular') {
    const midAx = markerA.x + (geom.aSide === 'right' ? dx : -dx);
    const midBx = markerB.x + (geom.bSide === 'right' ? dx : -dx);
    const midX = (midAx + midBx) / 2;
    ctx.lineTo(midX, markerA.y);
    ctx.lineTo(midX, markerB.y);
    ctx.lineTo(markerB.x, markerB.y);
    mid = { x: midX, y: (markerA.y + markerB.y) / 2 };
  } else {
    const c1 = { x: markerA.x + (geom.aSide === 'right' ? dx : -dx), y: markerA.y };
    const c2 = { x: markerB.x + (geom.bSide === 'right' ? dx : -dx), y: markerB.y };
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

function exportPng(): void {
  const b = bounds();
  if (!b) { window.alert('Nothing to export - add a table first.'); return; }

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

  downloadDataUrl(canvas.toDataURL('image/png'), 'erd-diagram.png');
}

export const pngExport = { exportPng };
