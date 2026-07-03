import { state } from './state';
import { modalEntity } from './modalEntity';
import { modalRelation } from './modalRelation';
import { relationInteraction } from './relationInteraction';
import { toolbar } from './toolbar';
import { ddlExport } from './ddlExport';
import { HEADER_COLOR_PALETTE, theme } from './theme';
import { ContextMenuItem, Entity, Point } from './types';

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

// headerEl, when given, is prepended above the item buttons with a
// separator line below it - used for the entity menu's header-color
// palette so it's reachable without opening the full table-details modal.
function show(items: ContextMenuItem[], x: number, y: number, headerEl?: HTMLElement): void {
  close();
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu';
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  if (headerEl) {
    menuEl.appendChild(headerEl);
    menuEl.appendChild(document.createElement('div')).className = 'context-menu-sep';
  }
  items.forEach((item) => {
    if (item.sepBefore) menuEl!.appendChild(document.createElement('div')).className = 'context-menu-sep';
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

// Same palette as the table-details modal (see modalEntity.ts's
// renderPalette) - lets the header color be changed with one click,
// directly from the right-click menu. When the right-clicked entity is part
// of a multi-selection, the chosen color is applied to every selected
// entity at once (batch recolor); otherwise just this one.
function buildPaletteHeader(entity: Entity): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'header-color-palette context-menu-palette';
  const targetIds = state.isEntitySelected(entity.id) && state.data.selectedEntityIds.length > 1
    ? state.data.selectedEntityIds.slice()
    : [entity.id];
  function render(): void {
    wrap.innerHTML = targetIds.length > 1
      ? '<span class="hint">Recolor ' + targetIds.length + ' tables</span>'
      : '';
    HEADER_COLOR_PALETTE.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch' + ((entity.headerColor || theme.colors.headerBg) === color ? ' selected' : '');
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        state.setHeaderColorForEntities(targetIds, color);
        entity.headerColor = color;
        render();
      });
      wrap.appendChild(swatch);
    });
  }
  render();
  return wrap;
}

function showForEntity(entityId: string, x: number, y: number): void {
  const entity = state.getEntity(entityId);
  if (!entity) return;
  show([
    { label: 'Edit Table', onClick: () => modalEntity.open(entityId) },
    { label: 'Create DDL', onClick: () => ddlExport.open(entityId) },
    { label: 'Delete table', danger: true, sepBefore: true, onClick: () => state.removeEntity(entityId) }
  ], x, y, buildPaletteHeader(entity));
}

function showForRelation(relationId: string, x: number, y: number): void {
  show([
    { label: 'Edit relation', onClick: () => modalRelation.openEdit(relationId) },
    { label: 'Delete relation', danger: true, onClick: () => relationInteraction.remove(relationId) }
  ], x, y);
}

function showForCanvas(worldPos: Point, x: number, y: number): void {
  show([
    { label: 'Create Entity/Table', onClick: () => toolbar.addTableAt(Math.round(worldPos.x), Math.round(worldPos.y)) }
  ], x, y);
}

export const contextMenu = { show, close, showForEntity, showForRelation, showForCanvas };
