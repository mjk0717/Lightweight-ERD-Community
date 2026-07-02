import { state } from './state';
import { clamp, closest } from './util';
import { entityRenderer } from './entityRenderer';
import { Point } from './types';

const FIT_MARGIN = 60;

// Handles panning + zooming of the canvas. The transform element gets
// `translate(x,y) scale(scale)`, so a world point (wx,wy) maps to a point
// relative to the viewport's top-left corner as:
//   screenX = view.x + wx*scale, screenY = view.y + wy*scale
let viewportEl: HTMLElement;
let transformEl: HTMLElement;
let panning = false;
let panStart: Point | null = null;
let viewStart: Point | null = null;

function view() { return state.data.view; }

function applyTransform(): void {
  const v = view();
  transformEl.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.scale + ')';
}

function screenToWorld(clientX: number, clientY: number): Point {
  const rect = viewportEl.getBoundingClientRect();
  const v = view();
  const sx = clientX - rect.left, sy = clientY - rect.top;
  return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const rect = viewportEl.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const v = view();
  const prevScale = v.scale;
  const factor = Math.exp(-e.deltaY * 0.001);
  const newScale = clamp(prevScale * factor, 0.3, 2.5);
  const wx = (mx - v.x) / prevScale, wy = (my - v.y) / prevScale;
  v.x = mx - wx * newScale;
  v.y = my - wy * newScale;
  v.scale = newScale;
  applyTransform();
  state.persist();
}

function onPanStart(e: MouseEvent): void {
  if (e.button !== 0) return;
  // only pan when starting on empty canvas background, not on an entity
  if (closest(e.target as HTMLElement, (el) => el.classList && el.classList.contains('entity'))) return;
  panning = true;
  panStart = { x: e.clientX, y: e.clientY };
  viewStart = { x: view().x, y: view().y };
  viewportEl.classList.add('panning');
  document.addEventListener('mousemove', onPanMove);
  document.addEventListener('mouseup', onPanEnd);
}

function onPanMove(e: MouseEvent): void {
  if (!panning || !panStart || !viewStart) return;
  view().x = viewStart.x + (e.clientX - panStart.x);
  view().y = viewStart.y + (e.clientY - panStart.y);
  applyTransform();
}

function onPanEnd(): void {
  panning = false;
  viewportEl.classList.remove('panning');
  document.removeEventListener('mousemove', onPanMove);
  document.removeEventListener('mouseup', onPanEnd);
  state.persist();
}

// Fits every entity's bounding box into the visible viewport (like "zoom to
// fit"), rather than just resetting to scale 1 / origin. Falls back to a
// plain reset when there's nothing on the canvas yet.
function resetView(): void {
  const v = view();
  const entities = state.data.entities;

  if (!entities.length) {
    v.x = 0; v.y = 0; v.scale = 1;
    applyTransform();
    state.persist();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  entities.forEach((e) => {
    const box = entityRenderer.getEntityBox(e.id);
    if (!box) return;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  });

  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);
  const viewportW = viewportEl.clientWidth;
  const viewportH = viewportEl.clientHeight;
  const scale = clamp(Math.min((viewportW - FIT_MARGIN * 2) / contentW, (viewportH - FIT_MARGIN * 2) / contentH), 0.2, 1.5);

  v.scale = scale;
  v.x = (viewportW - contentW * scale) / 2 - minX * scale;
  v.y = (viewportH - contentH * scale) / 2 - minY * scale;
  applyTransform();
  state.persist();
}

function init(viewport: HTMLElement, transform: HTMLElement): void {
  viewportEl = viewport;
  transformEl = transform;
  viewportEl.addEventListener('wheel', onWheel, { passive: false });
  viewportEl.addEventListener('mousedown', onPanStart);
  applyTransform();
}

export const viewport = { init, applyTransform, screenToWorld, resetView };
