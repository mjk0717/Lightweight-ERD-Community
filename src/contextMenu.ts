import { state } from './state';
import { modalEntity } from './modalEntity';
import { modalRelation } from './modalRelation';
import { ContextMenuItem } from './types';

let menuEl: HTMLElement | null = null;

function close(): void {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  document.removeEventListener('mousedown', onOutsideClick);
  document.removeEventListener('keydown', onKeydown);
}

function onOutsideClick(e: MouseEvent): void {
  if (menuEl && !menuEl.contains(e.target as Node)) close();
}
function onKeydown(e: KeyboardEvent): void { if (e.key === 'Escape') close(); }

function show(items: ContextMenuItem[], x: number, y: number): void {
  close();
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu';
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => { close(); item.onClick(); });
    menuEl!.appendChild(btn);
  });
  document.body.appendChild(menuEl);
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onKeydown);
  }, 0);
}

function showForEntity(entityId: string, x: number, y: number): void {
  show([
    { label: 'Edit details', onClick: () => modalEntity.open(entityId) },
    { label: 'Delete table', danger: true, onClick: () => state.removeEntity(entityId) }
  ], x, y);
}

function showForRelation(relationId: string, x: number, y: number): void {
  show([
    { label: 'Edit relation', onClick: () => modalRelation.openEdit(relationId) },
    { label: 'Delete relation', danger: true, onClick: () => {
      const relation = state.getRelation(relationId);
      if (!relation) return;
      const colId = relation.sourceColumnId, entId = relation.sourceEntityId;
      state.removeRelation(relationId);
      const stillUsed = state.data.relations.some((r) => r.sourceColumnId === colId);
      if (!stillUsed) state.updateColumn(entId, colId, { fk: false });
    } }
  ], x, y);
}

export const contextMenu = { show, close, showForEntity, showForRelation };
