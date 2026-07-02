import { state } from './state';
import { theme } from './theme';
import { downloadDataUrl } from './util';
import { entityRenderer } from './entityRenderer';
import { Box, Column, Entity, Point, Relation } from './types';

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

function computeEndpoints(aBox: Box, aRowY: number, bBox: Box, bRowY: number): Endpoints {
  const aCenterX = aBox.x + aBox.w / 2, bCenterX = bBox.x + bBox.w / 2;
  let aSide: 'left' | 'right', bSide: 'left' | 'right';
  if (aCenterX <= bCenterX) { aSide = 'right'; bSide = 'left'; } else { aSide = 'left'; bSide = 'right'; }
  const aPt = { x: aSide === 'right' ? aBox.x + aBox.w : aBox.x, y: aRowY };
  const bPt = { x: bSide === 'right' ? bBox.x + bBox.w : bBox.x, y: bRowY };
  return { aPt, bPt, aSide, bSide };
}

function drawRelation(ctx: CanvasRenderingContext2D, relation: Relation): void {
  const aBox = entityRenderer.getEntityBox(relation.sourceEntityId);
  const bBox = entityRenderer.getEntityBox(relation.targetEntityId);
  if (!aBox || !bBox) return;
  const aRow = entityRenderer.getColumnRowCenter(relation.sourceEntityId, relation.sourceColumnId);
  const bRow = entityRenderer.getColumnRowCenter(relation.targetEntityId, relation.targetColumnId);
  if (!aRow || !bRow) return;

  const geom = computeEndpoints(aBox, aRow.y, bBox, bRow.y);
  const dx = Math.max(Math.abs(geom.bPt.x - geom.aPt.x) * 0.5, 50);
  const c1 = { x: geom.aPt.x + (geom.aSide === 'right' ? dx : -dx), y: geom.aPt.y };
  const c2 = { x: geom.bPt.x + (geom.bSide === 'right' ? dx : -dx), y: geom.bPt.y };

  ctx.strokeStyle = theme.colors.relationStroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(geom.aPt.x, geom.aPt.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, geom.bPt.x, geom.bPt.y);
  ctx.stroke();

  // crow's foot (many) at source end
  const dirA = geom.aSide === 'right' ? 1 : -1;
  const backA = { x: geom.aPt.x + dirA * 12, y: geom.aPt.y };
  [-6, 0, 6].forEach((off) => {
    ctx.beginPath();
    ctx.moveTo(backA.x, backA.y + off);
    ctx.lineTo(geom.aPt.x, geom.aPt.y);
    ctx.stroke();
  });

  // one tick at target end
  const dirB = geom.bSide === 'right' ? 1 : -1;
  const backB = { x: geom.bPt.x + dirB * 9, y: geom.bPt.y };
  ctx.beginPath();
  ctx.moveTo(backB.x, backB.y - 6);
  ctx.lineTo(backB.x, backB.y + 6);
  ctx.stroke();

  if (relation.name) {
    const mid = bezierPointAt(geom.aPt, c1, c2, geom.bPt, 0.5);
    ctx.font = '11px ' + theme.fontFamily;
    const textWidth = ctx.measureText(relation.name).width;
    ctx.fillStyle = theme.colors.relationLabelBg;
    ctx.fillRect(mid.x - textWidth / 2 - 4, mid.y - 10, textWidth + 8, 16);
    ctx.fillStyle = theme.colors.text;
    ctx.textAlign = 'center';
    ctx.fillText(relation.name, mid.x, mid.y + 2);
    ctx.textAlign = 'left';
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, entity: Entity): void {
  const box = entityRenderer.getEntityBox(entity.id)!;
  ctx.fillStyle = theme.colors.headerBg;
  ctx.fillRect(box.x, box.y, box.w, theme.headerHeight);
  ctx.fillStyle = theme.colors.headerText;
  ctx.font = 'bold 13px ' + theme.fontFamily;
  ctx.textBaseline = 'middle';
  ctx.fillText(entity.name, box.x + 8, box.y + theme.headerHeight / 2 + 1, box.w - 16);

  entity.columns.forEach((col, idx) => {
    const rowY = box.y + theme.headerHeight + idx * theme.rowHeight;
    ctx.fillStyle = rowBackground(col, idx);
    ctx.fillRect(box.x, rowY, box.w, theme.rowHeight);

    const flag = col.pk ? 'PK' : (col.fk ? 'FK' : '');
    if (flag) {
      ctx.font = 'bold 10px ' + theme.fontFamily;
      ctx.fillStyle = theme.colors.subtext;
      ctx.fillText(flag, box.x + 6, rowY + theme.rowHeight / 2 + 1);
    }
    ctx.font = '12px ' + theme.fontFamily;
    ctx.fillStyle = col.isSystem ? theme.colors.systemText : theme.colors.text;
    ctx.fillText(col.name, box.x + 30, rowY + theme.rowHeight / 2 + 1, box.w - 100);

    ctx.font = '11px ' + theme.fontFamily;
    ctx.fillStyle = theme.colors.subtext;
    ctx.textAlign = 'right';
    ctx.fillText(col.dataType, box.x + box.w - 6, rowY + theme.rowHeight / 2 + 1, 90);
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
