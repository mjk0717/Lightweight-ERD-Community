import { state } from './state';
import { viewport } from './viewport';
import { entityRenderer } from './entityRenderer';
import { entityDrag } from './entityDrag';
import { relationRenderer } from './relationRenderer';
import { relationInteraction } from './relationInteraction';
import { toolbar } from './toolbar';
import { menuBar } from './menuBar';
import { minimap } from './minimap';
import { contextMenu } from './contextMenu';
import { history } from './history';
import { defaultDiagram } from './defaultDiagram';
import { closest, nextId } from './util';
import { Entity } from './types';

// In-memory clipboard for copying/duplicating tables within the diagram.
// Holds deep clones of the copied entities only - relations are never copied,
// so pasted tables come in unconnected.
let clipboard: Entity[] = [];
let pasteCount = 0;

function copySelected(): void {
  const ids = state.data.selectedEntityIds;
  if (!ids.length) return;
  clipboard = ids
    .map((id) => state.getEntity(id))
    .filter((e): e is Entity => !!e)
    .map((e) => JSON.parse(JSON.stringify(e)) as Entity);
  pasteCount = 0;
}

// A name not already taken - "FOO" -> "FOO_COPY", then "FOO_COPY2", etc. -
// so duplicated tables never collide (which would confuse name-based DDL
// export and relation matching).
function uniqueEntityName(base: string): string {
  const names = new Set(state.data.entities.map((e) => e.name.toUpperCase()));
  let candidate = base + '_COPY';
  let n = 2;
  while (names.has(candidate.toUpperCase())) { candidate = base + '_COPY' + n; n++; }
  return candidate;
}

function pasteClipboard(): void {
  if (!clipboard.length) return;
  // Cascade repeated pastes so copies don't stack exactly on each other.
  pasteCount++;
  const off = 24 * pasteCount;
  const newIds: string[] = [];
  clipboard.forEach((src) => {
    const columns = src.columns.map((c) => Object.assign({}, c, { id: nextId('col') }));
    const entity: Entity = {
      id: nextId('ent'), name: uniqueEntityName(src.name), comment: src.comment,
      x: src.x + off, y: src.y + off, headerColor: src.headerColor, columns
    };
    state.addEntity(entity);
    newIds.push(entity.id);
  });
  state.selectEntities(newIds);
}

function deleteSelected(): void {
  // Multi-selected entities delete together; otherwise fall back to the
  // single primary selection (which also covers relation selection).
  if (state.data.selectedEntityIds.length) {
    state.data.selectedEntityIds.slice().forEach((id) => state.removeEntity(id));
    state.clearSelection();
    return;
  }
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
  // A modal (table editor, wizards...) handles its own copy/paste/delete.
  if (document.querySelector('.modal-overlay')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'c' && state.data.selectedEntityIds.length) { e.preventDefault(); copySelected(); }
    else if (k === 'v' && clipboard.length) { e.preventDefault(); pasteClipboard(); }
    else if (k === 'a' && state.data.entities.length) {
      e.preventDefault();
      state.selectEntities(state.data.entities.map((en) => en.id));
    }
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
  // A fresh tab session (nothing in sessionStorage yet) opens on the bundled
  // sample diagram rather than an empty canvas.
  if (!state.load()) state.replaceAll(defaultDiagram);
  history.init();

  const viewportEl = document.getElementById('canvas-viewport')!;
  const transformEl = document.getElementById('canvas-transform')!;
  const entityLayer = document.getElementById('entity-layer')!;
  const svg = document.getElementById('relation-svg') as unknown as SVGSVGElement;

  viewport.init(viewportEl, transformEl);
  entityRenderer.init(entityLayer);
  entityDrag.init(entityLayer);
  relationRenderer.init(svg);
  toolbar.init();
  menuBar.init();
  minimap.init();

  viewportEl.addEventListener('click', onCanvasBackgroundClick);
  viewportEl.addEventListener('contextmenu', onCanvasBackgroundContextMenu);
  document.addEventListener('keydown', onKeydown);

  const hint = document.getElementById('empty-hint')!;
  const syncHint = () => { hint.style.display = state.data.entities.length ? 'none' : ''; };
  syncHint();
  state.on('change', syncHint);
}

document.addEventListener('DOMContentLoaded', init);
