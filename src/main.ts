import { state } from './state';
import { viewport } from './viewport';
import { entityRenderer } from './entityRenderer';
import { entityDrag } from './entityDrag';
import { relationRenderer } from './relationRenderer';
import { toolbar } from './toolbar';

function deleteSelected(): void {
  const sel = state.data.selected;
  if (!sel) return;
  if (sel.type === 'entity') {
    state.removeEntity(sel.id);
  } else if (sel.type === 'relation') {
    const relation = state.getRelation(sel.id);
    if (!relation) return;
    const colId = relation.sourceColumnId, entId = relation.sourceEntityId;
    state.removeRelation(sel.id);
    const stillUsed = state.data.relations.some((r) => r.sourceColumnId === colId);
    if (!stillUsed) state.updateColumn(entId, colId, { fk: false });
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

function onCanvasBackgroundClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.id === 'canvas-viewport' || target.id === 'entity-layer' || target.id === 'relation-svg') {
    state.clearSelection();
  }
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
  document.addEventListener('keydown', onKeydown);

  const hint = document.getElementById('empty-hint')!;
  if (!state.data.entities.length) hint.style.display = '';
  state.on('change', () => {
    hint.style.display = state.data.entities.length ? 'none' : '';
  });
}

document.addEventListener('DOMContentLoaded', init);
