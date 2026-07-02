import { state } from './state';
import { viewport } from './viewport';
import { entityRenderer } from './entityRenderer';
import { entityDrag } from './entityDrag';
import { relationRenderer } from './relationRenderer';
import { relationInteraction } from './relationInteraction';
import { toolbar } from './toolbar';
import { contextMenu } from './contextMenu';
import { closest } from './util';

function deleteSelected(): void {
  const sel = state.data.selected;
  if (!sel) return;
  if (sel.type === 'entity') {
    state.removeEntity(sel.id);
  } else if (sel.type === 'relation') {
    relationInteraction.remove(sel.id);
  }
  state.clearSelection();
}

function onKeydown(e: KeyboardEvent): void {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  }
}

function isOnEntityOrRelation(target: HTMLElement): boolean {
  return !!closest(target, (el) => el.classList && (el.classList.contains('entity') || el.classList.contains('relation')));
}

function onCanvasBackgroundClick(e: MouseEvent): void {
  if (isOnEntityOrRelation(e.target as HTMLElement)) return;
  state.clearSelection();
}

function onCanvasBackgroundContextMenu(e: MouseEvent): void {
  // Entity/relation right-clicks are handled by their own (closer) listeners;
  // this only fires for genuine empty-canvas background right-clicks.
  if (isOnEntityOrRelation(e.target as HTMLElement)) return;
  e.preventDefault();
  const worldPos = viewport.screenToWorld(e.clientX, e.clientY);
  contextMenu.showForCanvas(worldPos, e.clientX, e.clientY);
}

function init(): void {
  state.load();

  const viewportEl = document.getElementById('canvas-viewport')!;
  const transformEl = document.getElementById('canvas-transform')!;
  const entityLayer = document.getElementById('entity-layer')!;
  const svg = document.getElementById('relation-svg') as unknown as SVGSVGElement;

  viewport.init(viewportEl, transformEl);
  entityRenderer.init(entityLayer);
  entityDrag.init(entityLayer);
  relationRenderer.init(svg);
  toolbar.init();

  viewportEl.addEventListener('click', onCanvasBackgroundClick);
  viewportEl.addEventListener('contextmenu', onCanvasBackgroundContextMenu);
  document.addEventListener('keydown', onKeydown);

  const hint = document.getElementById('empty-hint')!;
  const syncHint = () => { hint.style.display = state.data.entities.length ? 'none' : ''; };
  syncHint();
  state.on('change', syncHint);
}

document.addEventListener('DOMContentLoaded', init);
