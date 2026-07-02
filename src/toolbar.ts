import { state } from './state';
import { nextId } from './util';
import { modalEntity } from './modalEntity';
import { modalSystemColumns } from './modalSystemColumns';
import { ddlImport } from './ddlImport';
import { pngExport } from './pngExport';
import { jsonIO } from './jsonIO';
import { viewport } from './viewport';
import { Entity } from './types';

function addTable(): void {
  const pos = state.nextEntityPosition();
  const entity: Entity = {
    id: nextId('ent'), name: 'NEW_TABLE', comment: '', x: pos.x, y: pos.y,
    columns: [{ id: nextId('col'), name: 'ID', dataType: 'NUMBER(10)', comment: '', pk: true, fk: false, nullable: false, isSystem: false, systemColId: null }]
  };
  state.applySystemColumnsToEntity(entity);
  state.addEntity(entity);
  modalEntity.open(entity.id);
}

function clearAll(): void {
  if (!window.confirm('Remove all tables and relations? System column definitions are kept.')) return;
  state.data.entities = [];
  state.data.relations = [];
  state.emit('change');
}

function bind(id: string, handler: () => void): void {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function init(): void {
  bind('btn-add-table', addTable);
  bind('btn-import-ddl', () => ddlImport.open());
  bind('btn-export-png', () => pngExport.exportPng());
  bind('btn-export-json', () => jsonIO.exportJson());
  bind('btn-import-json', () => jsonIO.importJson());
  bind('btn-system-columns', () => modalSystemColumns.open());
  bind('btn-reset-view', () => viewport.resetView());
  bind('btn-clear-all', clearAll);
}

export const toolbar = { init, addTable };
