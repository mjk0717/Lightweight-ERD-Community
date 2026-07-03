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
  if (col.isSystem) return 'S';
  if (col.pk && col.fk) return 'P/F';
  if (col.pk) return 'PK';
  if (col.fk) return 'FK';
  return '';
}

// Logical design mode favors the business-friendly comment over the
// technical name, falling back to the name when no comment is set.
function displayEntityName(entity: Entity): string {
  if (state.data.designMode === 'logical' && entity.comment) return entity.comment;
  return entity.name;
}

function displayColumnName(col: Column): string {
  if (state.data.designMode === 'logical' && col.comment) return col.comment;
  return col.name;
}

function rowClass(col: Column, idx: number): string {
  const cls = ['entity-row'];
  if (col.isSystem) cls.push('row-system');
  else if (col.pk) cls.push('row-pk');
  else if (idx % 2 === 1) cls.push('row-alt');
  if (col.fk) cls.push('row-fk');
  return cls.join(' ');
}

// Everything the row markup actually depends on - used to skip rebuilding
// the body's rows on renders that don't touch columns (e.g. a 'select' or
// 'move' event). Rebuilding unconditionally on every render replaces the
// row elements even when nothing about them changed, which - among other
// things - breaks the browser's native double-click detection, since a
// dblclick requires the same DOM node to receive both clicks.
function rowsSignature(entity: Entity): string {
  return state.data.designMode + '|' + JSON.stringify(entity.columns.map((c) =>
    [c.id, c.name, c.comment, c.dataType, c.pk, c.fk, c.nullable, c.isSystem]
  ));
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
  header.style.background = entity.headerColor || theme.colors.headerBg;
  (header.querySelector('.entity-name') as HTMLElement).textContent = displayEntityName(entity);

  const body = node.querySelector('.entity-body') as HTMLElement;
  const sig = rowsSignature(entity);
  if (body.dataset.rowsSig !== sig) {
    body.dataset.rowsSig = sig;
    body.innerHTML = '';
    entity.columns.forEach((col, idx) => {
      const row = document.createElement('div');
      row.className = rowClass(col, idx);
      row.dataset.colId = col.id;
      row.dataset.entityId = entity.id;
      row.title = col.name + ' : ' + col.dataType + ' ' + (col.nullable ? 'NULL' : 'NOT NULL') + (col.comment ? '\n' + col.comment : '');
      row.innerHTML =
        '<span class="row-flag">' + rowFlag(col) + '</span>' +
        '<span class="row-name">' + escapeHtml(displayColumnName(col)) + '</span>' +
        '<span class="row-type">' + escapeHtml(col.dataType) +
          (col.nullable ? '' : '<span class="not-null-mark" title="NOT NULL">*</span>') +
        '</span>';
      body.appendChild(row);
    });
  }

  // Columns involved in the currently-selected relation (on the side this
  // entity plays, parent or child) get a highlight. A plain class toggle on
  // the existing row elements, deliberately outside the rebuild-skip check
  // above, so it stays responsive even when the row markup itself didn't
  // change - and never disturbs row identity for double-click purposes.
  const hlIds = highlightedColumnIds(entity.id);
  Array.prototype.forEach.call(body.children, (row: HTMLElement) => {
    const colId = row.dataset.colId;
    row.classList.toggle('row-highlighted', !!colId && hlIds.has(colId));
  });

  node.classList.toggle('selected', state.isEntitySelected(entity.id));
}

function highlightedColumnIds(entityId: string): Set<string> {
  const selected = state.data.selected;
  if (!selected || selected.type !== 'relation') return new Set();
  const relation = state.getRelation(selected.id);
  if (!relation) return new Set();
  const ids = new Set<string>();
  relation.columnPairs.forEach((p) => {
    if (relation.sourceEntityId === entityId) ids.add(p.sourceColumnId);
    if (relation.targetEntityId === entityId) ids.add(p.targetColumnId);
  });
  return ids;
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

export const entityRenderer = {
  init, render, entityHeight, getEntityBox, getColumnRowCenter,
  displayName: displayEntityName, displayColumnName
};
