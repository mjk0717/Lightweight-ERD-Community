import { state } from './state';
import { viewport } from './viewport';
import { closest } from './util';
import { relationInteraction } from './relationInteraction';
import { modalEntity } from './modalEntity';
import { contextMenu } from './contextMenu';

let layerEl: HTMLElement;

function startMove(entityId: string, startEvent: MouseEvent): void {
  const entity = state.getEntity(entityId);
  if (!entity) return;
  const startWorld = viewport.screenToWorld(startEvent.clientX, startEvent.clientY);
  const origin = { x: entity.x, y: entity.y };
  let moved = false;

  function onMove(ev: MouseEvent): void {
    const w = viewport.screenToWorld(ev.clientX, ev.clientY);
    const dx = w.x - startWorld.x, dy = w.y - startWorld.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    state.moveEntity(entityId, Math.round(origin.x + dx), Math.round(origin.y + dy));
  }
  function onUp(): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (moved) state.persist();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  const header = closest(target, (el) => el.classList && el.classList.contains('entity-header'));
  if (header) {
    e.stopPropagation();
    const entityNode = closest(header, (el) => !!el.dataset && !!el.dataset.entityId)!;
    const entityId = entityNode.dataset.entityId!;
    state.select('entity', entityId);
    startMove(entityId, e);
    return;
  }
  // Anywhere else on the entity (the whole body, not just a specific column
  // row) starts a relation drag - which column(s) end up as the FK is
  // decided later in the create-relation modal, not by where you grabbed.
  const body = closest(target, (el) => el.classList && el.classList.contains('entity-body'));
  if (body) {
    e.stopPropagation();
    const entityNode = closest(body, (el) => !!el.dataset && !!el.dataset.entityId)!;
    const entityId = entityNode.dataset.entityId!;
    state.select('entity', entityId);
    relationInteraction.start(entityId, e);
  }
}

function onDblClick(e: MouseEvent): void {
  const entityNode = closest(e.target as HTMLElement, (el) => el.classList && el.classList.contains('entity'));
  if (!entityNode) return;
  modalEntity.open(entityNode.dataset.entityId!);
}

function onContextMenu(e: MouseEvent): void {
  // entity-layer no longer intercepts clicks over empty canvas (see
  // #entity-layer { pointer-events: none } in style.css, needed so relation
  // lines underneath stay clickable) - so this only ever fires for a genuine
  // .entity hit now. The empty-canvas "Create Entity/Table" menu lives on
  // the viewport itself (main.ts), which still receives everything that
  // isn't an entity or relation.
  const entityNode = closest(e.target as HTMLElement, (el) => el.classList && el.classList.contains('entity'));
  if (!entityNode) return;
  e.preventDefault();
  // state.select() re-renders the entity body (innerHTML is rebuilt), which
  // detaches e.target from the DOM if it was inside a column row. The
  // viewport's own contextmenu listener would then walk up from that
  // orphaned node, fail to find .entity, and clobber this menu with the
  // empty-canvas one - stop the event here so it never gets that far.
  e.stopPropagation();
  state.select('entity', entityNode.dataset.entityId!);
  contextMenu.showForEntity(entityNode.dataset.entityId!, e.clientX, e.clientY);
}

function init(layer: HTMLElement): void {
  layerEl = layer;
  layerEl.addEventListener('mousedown', onMouseDown);
  layerEl.addEventListener('dblclick', onDblClick);
  layerEl.addEventListener('contextmenu', onContextMenu);
}

export const entityDrag = { init };
