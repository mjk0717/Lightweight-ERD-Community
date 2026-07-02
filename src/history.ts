import { state } from './state';
import { Entity, Relation, SystemColumnDef } from './types';

// App-wide undo/redo over the diagram's actual content (entities,
// relations, system column definitions) - not view/selection/design-mode/
// line-style, which are display preferences a user wouldn't expect Ctrl+Z
// to touch. Every 'change'/'move' event schedules a debounced checkpoint;
// rapid-fire updates (a drag, a multi-step import) settle into one step
// instead of one per intermediate event.

interface Snapshot {
  entities: Entity[];
  relations: Relation[];
  systemColumns: SystemColumnDef[];
}

const MAX_HISTORY = 100;
const DEBOUNCE_MS = 400;

let stack: Snapshot[] = [];
let index = -1;
let suppress = false;
let debounceTimer: number | null = null;

function cloneSnapshot(): Snapshot {
  return {
    entities: JSON.parse(JSON.stringify(state.data.entities)),
    relations: JSON.parse(JSON.stringify(state.data.relations)),
    systemColumns: JSON.parse(JSON.stringify(state.data.systemColumns))
  };
}

function pushSnapshot(): void {
  if (suppress) return;
  const snap = cloneSnapshot();
  if (index >= 0 && JSON.stringify(stack[index]) === JSON.stringify(snap)) return;
  stack = stack.slice(0, index + 1);
  stack.push(snap);
  index++;
  if (stack.length > MAX_HISTORY) { stack.shift(); index--; }
}

function scheduleSnapshot(): void {
  if (suppress) return;
  if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => { debounceTimer = null; pushSnapshot(); }, DEBOUNCE_MS);
}

function applySnapshot(snap: Snapshot): void {
  suppress = true;
  state.data.entities = JSON.parse(JSON.stringify(snap.entities));
  state.data.relations = JSON.parse(JSON.stringify(snap.relations));
  state.data.systemColumns = JSON.parse(JSON.stringify(snap.systemColumns));
  state.data.selected = null;
  state.emit('change');
  state.emit('select');
  suppress = false;
}

// A pending debounced snapshot represents "in-progress" edits that haven't
// settled yet - flush it first so undo always steps from the latest state,
// not from whatever the last completed checkpoint happened to be.
function flushPending(): void {
  if (debounceTimer !== null) { window.clearTimeout(debounceTimer); debounceTimer = null; pushSnapshot(); }
}

function undo(): void {
  flushPending();
  if (index <= 0) return;
  index--;
  applySnapshot(stack[index]);
}

function redo(): void {
  if (index >= stack.length - 1) return;
  index++;
  applySnapshot(stack[index]);
}

function canUndo(): boolean { return index > 0; }
function canRedo(): boolean { return index < stack.length - 1; }

// Global Ctrl+Z/Ctrl+Y only while no modal is open - a modal (table
// details, DDL/JSON import, system columns...) either has its own local
// undo (table details) or is plain text editing that should keep the
// browser's native per-field undo, not have it hijacked by this.
function onKeydown(e: KeyboardEvent): void {
  if (document.querySelector('.modal-overlay')) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

function init(): void {
  pushSnapshot();
  state.on('change', scheduleSnapshot);
  state.on('move', scheduleSnapshot);
  document.addEventListener('keydown', onKeydown);
}

export const history = { init, undo, redo, canUndo, canRedo };
