import { state } from './state';
import { nextId } from './util';
import { modalEntity } from './modalEntity';
import { modalSystemColumns } from './modalSystemColumns';
import { ddlImport } from './ddlImport';
import { pngExport } from './pngExport';
import { jsonIO } from './jsonIO';
import { viewport } from './viewport';
import { Entity } from './types';

function addTableAt(x: number, y: number): void {
  const entity: Entity = {
    id: nextId('ent'), name: 'NEW_TABLE', comment: '', x, y,
    columns: [{ id: nextId('col'), name: 'ID', dataType: 'NUMBER(10)', comment: '', pk: true, fk: false, nullable: false, isSystem: false, systemColId: null }]
  };
  state.applySystemColumnsToEntity(entity);
  state.addEntity(entity);
  modalEntity.open(entity.id, { isNew: true });
}

function addTable(): void {
  const pos = state.nextEntityPosition();
  addTableAt(pos.x, pos.y);
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

function initModeSwitch(): void {
  // Label order is Logical (left) - toggle - Physical (right), so the thumb
  // sits on whichever side matches the active mode: unchecked/left = Logical,
  // checked/right = Physical.
  const toggle = document.getElementById('mode-toggle') as HTMLInputElement | null;
  if (!toggle) return;
  const sync = () => { toggle.checked = state.data.designMode === 'physical'; };
  sync();
  toggle.addEventListener('change', () => state.setDesignMode(toggle.checked ? 'physical' : 'logical'));
  state.on('change', sync);
}

function initLineStyleButton(): void {
  const btn = document.getElementById('btn-line-style');
  if (!btn) return;
  const sync = () => { btn.textContent = state.data.lineStyle === 'angular' ? 'Line: Angular' : 'Line: Curved'; };
  sync();
  btn.addEventListener('click', () => state.setLineStyle(state.data.lineStyle === 'angular' ? 'curved' : 'angular'));
  state.on('change', sync);
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
  initModeSwitch();
  initLineStyleButton();
}

export const toolbar = { init, addTable, addTableAt };
