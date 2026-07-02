import { state } from './state';
import { theme } from './theme';
import { escapeHtml } from './util';
import { Box, Column, Entity, RowCenter } from './types';

let layerEl: HTMLElement;
const nodeMap = new Map<string, HTMLElement>();

function entityHeight(entity: Entity): number {
  return theme.headerHeight + entity.columns.length * theme.rowHeight;
}

function getEntityBox(id: string): Box | null {
  const e = state.getEntity(id);
  if (!e) return null;
  return { x: e.x, y: e.y, w: theme.entityWidth, h: entityHeight(e) };
}

// world-space center point of a column's row, for relation endpoints
function getColumnRowCenter(entityId: string, colId: string): RowCenter | null {
  const e = state.getEntity(entityId);
  if (!e) return null;
  const idx = e.columns.findIndex((c) => c.id === colId);
  if (idx === -1) return null;
  return {
    x: e.x,
    xRight: e.x + theme.entityWidth,
    y: e.y + theme.headerHeight + idx * theme.rowHeight + theme.rowHeight / 2
  };
}

function rowFlag(col: Column): string {
  if (col.pk) return 'PK';
  if (col.fk) return 'FK';
  return '';
}

function rowClass(col: Column, idx: number): string {
  const cls = ['entity-row'];
  if (col.isSystem) cls.push('row-system');
  else if (col.pk) cls.push('row-pk');
  else if (idx % 2 === 1) cls.push('row-alt');
  if (col.fk) cls.push('row-fk');
  return cls.join(' ');
}

function buildEntityNode(entity: Entity): HTMLElement {
  const node = document.createElement('div');
  node.className = 'entity';
  node.dataset.entityId = entity.id;
  node.innerHTML =
    '<div class="entity-header" title="' + escapeHtml(entity.name) + (entity.comment ? ' - ' + escapeHtml(entity.comment) : '') + '">' +
      '<span class="entity-name"></span>' +
    '</div>' +
    '<div class="entity-body"></div>';
  return node;
}

function updateEntityNode(node: HTMLElement, entity: Entity): void {
  node.style.left = entity.x + 'px';
  node.style.top = entity.y + 'px';
  node.style.width = theme.entityWidth + 'px';
  const header = node.querySelector('.entity-header') as HTMLElement;
  header.title = entity.name + (entity.comment ? ' - ' + entity.comment : '');
  (header.querySelector('.entity-name') as HTMLElement).textContent = entity.name;

  const body = node.querySelector('.entity-body') as HTMLElement;
  body.innerHTML = '';
  entity.columns.forEach((col, idx) => {
    const row = document.createElement('div');
    row.className = rowClass(col, idx);
    row.dataset.colId = col.id;
    row.dataset.entityId = entity.id;
    row.title = col.name + ' : ' + col.dataType + (col.comment ? '\n' + col.comment : '');
    row.innerHTML =
      '<span class="row-flag">' + rowFlag(col) + '</span>' +
      '<span class="row-name">' + escapeHtml(col.name) + '</span>' +
      '<span class="row-type">' + escapeHtml(col.dataType) + '</span>';
    body.appendChild(row);
  });

  const selected = state.data.selected;
  node.classList.toggle('selected', !!(selected && selected.type === 'entity' && selected.id === entity.id));
}

function render(): void {
  const entities = state.data.entities;
  const seen = new Set<string>();
  entities.forEach((entity) => {
    seen.add(entity.id);
    let node = nodeMap.get(entity.id);
    if (!node) {
      node = buildEntityNode(entity);
      nodeMap.set(entity.id, node);
      layerEl.appendChild(node);
    }
    updateEntityNode(node, entity);
  });
  nodeMap.forEach((node, id) => {
    if (!seen.has(id)) {
      node.remove();
      nodeMap.delete(id);
    }
  });
}

function init(layer: HTMLElement): void {
  layerEl = layer;
  state.on('change', render);
  state.on('move', render);
  state.on('select', render);
  render();
}

export const entityRenderer = { init, render, entityHeight, getEntityBox, getColumnRowCenter };
