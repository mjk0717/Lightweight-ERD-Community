import { state } from './state';
import { nextId } from './util';
import { modalEntity } from './modalEntity';
import { Entity } from './types';

function addTableAt(x: number, y: number): void {
  const entity: Entity = {
    id: nextId('ent'), name: 'NEW_TABLE', comment: '', x, y, headerColor: null,
    columns: [{ id: nextId('col'), name: 'ID', dataType: 'NUMBER(10)', comment: '', pk: true, fk: false, nullable: false, isSystem: false, systemColId: null }]
  };
  state.applySystemColumnsToEntity(entity);
  modalEntity.openNew(entity);
}

// The Logical/Physical toggle switch lives in the toolbar (kept as a
// quick-access control alongside the menu bar's View menu). Label order is
// Logical (left) - toggle - Physical (right): unchecked = Logical, checked =
// Physical, and it re-syncs whenever the mode changes elsewhere (e.g. the
// View menu).
function initModeSwitch(): void {
  const toggle = document.getElementById('mode-toggle') as HTMLInputElement | null;
  if (!toggle) return;
  const sync = () => { toggle.checked = state.data.designMode === 'physical'; };
  sync();
  toggle.addEventListener('change', () => state.setDesignMode(toggle.checked ? 'physical' : 'logical'));
  state.on('change', sync);
}

function init(): void {
  initModeSwitch();
}

export const toolbar = { init, addTableAt };
