import { state } from './state';
import { modal } from './modal';
import { escapeHtml, ORACLE_TYPES } from './util';
import { SystemColumnDef } from './types';

let draft: SystemColumnDef[] = [];
let gridBody: HTMLElement;

// Row reorder state (drag handle) - mirrors the table details grid so the two
// column editors behave identically.
let dragIndex: number | null = null;
let dragMoved = false;

function newDef(): SystemColumnDef {
  return { id: '', name: 'NEW_COLUMN', dataType: 'VARCHAR2(50)', comment: '', defaultValue: '' };
}

function renderRow(def: SystemColumnDef, idx: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'col-row' + (dragIndex === idx ? ' dragging' : '');
  tr.innerHTML =
    '<td class="col-handle-cell"><span class="drag-handle" title="Drag to reorder">⋮⋮</span></td>' +
    '<td class="col-order">' + (idx + 1) + '</td>' +
    '<td><input type="text" class="f-name" value="' + escapeHtml(def.name) + '"></td>' +
    '<td><input type="text" class="f-comment" value="' + escapeHtml(def.comment || '') + '"></td>' +
    '<td><input type="text" class="f-type" list="oracle-types-datalist" value="' + escapeHtml(def.dataType) + '"></td>' +
    '<td><input type="text" class="f-default" value="' + escapeHtml(def.defaultValue || '') + '"></td>' +
    '<td><button type="button" class="btn-icon btn-del-sys" title="Remove">✕</button></td>';

  (tr.querySelector('.f-name') as HTMLInputElement).addEventListener('input', (e) => { def.name = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.f-comment') as HTMLInputElement).addEventListener('input', (e) => { def.comment = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.f-type') as HTMLInputElement).addEventListener('input', (e) => { def.dataType = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.f-default') as HTMLInputElement).addEventListener('input', (e) => { def.defaultValue = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.btn-del-sys') as HTMLButtonElement).addEventListener('click', () => {
    draft = draft.filter((d) => d !== def);
    renderGrid();
  });

  const handle = tr.querySelector('.drag-handle') as HTMLElement;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragIndex = idx;
    dragMoved = false;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  });
  return tr;
}

function onDragMove(e: MouseEvent): void {
  if (dragIndex === null) return;
  const rows = Array.prototype.slice.call(gridBody.querySelectorAll('tr')) as HTMLElement[];
  const overRow = rows.find((r) => {
    const rect = r.getBoundingClientRect();
    return e.clientY >= rect.top && e.clientY <= rect.bottom;
  });
  if (!overRow) return;
  const overIndex = rows.indexOf(overRow);
  if (overIndex === -1 || overIndex === dragIndex) return;
  const moved = draft.splice(dragIndex, 1)[0];
  draft.splice(overIndex, 0, moved);
  dragIndex = overIndex;
  dragMoved = true;
  renderGrid();
}

function onDragEnd(): void {
  const moved = dragMoved;
  dragIndex = null;
  dragMoved = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (moved) renderGrid();
}

function renderGrid(): void {
  gridBody.innerHTML = '';
  draft.forEach((def, idx) => gridBody.appendChild(renderRow(def, idx)));
}

function open(): void {
  draft = JSON.parse(JSON.stringify(state.data.systemColumns));

  const body = document.createElement('div');
  body.innerHTML =
    '<p class="hint">System columns are appended to every table (shown in yellow) - e.g. CREATED_BY, CREATED_DATE.</p>' +
    '<datalist id="oracle-types-datalist">' + ORACLE_TYPES.map((t) => '<option value="' + t + '">').join('') + '</datalist>' +
    '<table class="col-grid">' +
      '<thead><tr><th></th><th>#</th><th>Name</th><th>Comment</th><th>Data type</th><th>Default</th><th></th></tr></thead>' +
      '<tbody></tbody>' +
    '</table>' +
    '<button type="button" class="btn btn-add-sys">+ Add system column</button>';

  gridBody = body.querySelector('tbody')!;
  renderGrid();
  (body.querySelector('.btn-add-sys') as HTMLButtonElement).addEventListener('click', () => { draft.push(newDef()); renderGrid(); });

  modal.open({
    title: 'System columns',
    width: '640px',
    body,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Apply to all tables', variant: 'primary', onClick: () => {
        state.setSystemColumns(draft.filter((d) => d.name.trim()));
        modal.close();
      } }
    ]
  });
}

export const modalSystemColumns = { open };
