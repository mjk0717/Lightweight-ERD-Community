import { state } from './state';
import { modal } from './modal';
import { escapeHtml, dataTypeSuggestions } from './util';
import { SystemColumnDef } from './types';

let draft: SystemColumnDef[] = [];
let gridBody: HTMLElement;

// Row reorder state (drag handle) - mirrors the table details grid so the two
// column editors behave identically.
let dragIndex: number | null = null;
let dragMoved = false;

// Excel-like range selection / copy-paste over the free-text columns, same as
// the table details grid.
type CellField = 'name' | 'comment' | 'dataType' | 'defaultValue';
const CELL_FIELDS: CellField[] = ['name', 'comment', 'dataType', 'defaultValue'];
const CELL_CLASSES = ['f-name', 'f-comment', 'f-type', 'f-default'];
interface CellIdx { row: number; col: number; }
let selAnchor: CellIdx | null = null;
let selFocus: CellIdx | null = null;
let isSelecting = false;

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
    '<td><input type="text" class="f-type" list="col-type-datalist" value="' + escapeHtml(def.dataType) + '"></td>' +
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

// ---------- row reorder ----------
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

// ---------- Excel-like cell selection / copy-paste ----------
function cellInput(row: number, col: number): HTMLInputElement | null {
  const tr = gridBody.querySelectorAll('tr')[row] as HTMLElement | undefined;
  if (!tr) return null;
  return tr.querySelector('.' + CELL_CLASSES[col]) as HTMLInputElement | null;
}

function cellIndexOf(input: HTMLInputElement): CellIdx | null {
  const tr = input.closest('tr');
  if (!tr) return null;
  const rows = Array.prototype.slice.call(gridBody.querySelectorAll('tr')) as HTMLElement[];
  const row = rows.indexOf(tr as HTMLElement);
  const col = CELL_CLASSES.findIndex((cls) => input.classList.contains(cls));
  if (row === -1 || col === -1) return null;
  return { row, col };
}

function rangeBounds(): { r0: number; r1: number; c0: number; c1: number } | null {
  if (!selAnchor || !selFocus) return null;
  return {
    r0: Math.min(selAnchor.row, selFocus.row), r1: Math.max(selAnchor.row, selFocus.row),
    c0: Math.min(selAnchor.col, selFocus.col), c1: Math.max(selAnchor.col, selFocus.col)
  };
}

function refreshSelectionHighlight(): void {
  gridBody.querySelectorAll('.cell-selected').forEach((el) => el.classList.remove('cell-selected'));
  const b = rangeBounds();
  if (!b) return;
  for (let r = b.r0; r <= b.r1; r++) {
    for (let c = b.c0; c <= b.c1; c++) {
      const input = cellInput(r, c);
      if (input) input.classList.add('cell-selected');
    }
  }
}

function onGridMouseDown(e: MouseEvent): void {
  const input = (e.target as HTMLElement).closest('input') as HTMLInputElement | null;
  if (!input) return;
  const idx = cellIndexOf(input);
  if (!idx) return;
  isSelecting = true;
  selAnchor = idx;
  selFocus = idx;
  refreshSelectionHighlight();
}

function onGridMouseOver(e: MouseEvent): void {
  if (!isSelecting) return;
  const input = (e.target as HTMLElement).closest('input') as HTMLInputElement | null;
  if (!input) return;
  const idx = cellIndexOf(input);
  if (!idx) return;
  selFocus = idx;
  refreshSelectionHighlight();
}

function onGridMouseUp(): void { isSelecting = false; }

function onGridCopy(e: ClipboardEvent): void {
  if (!document.contains(gridBody)) return;
  const active = document.activeElement;
  if (!active || !gridBody.contains(active)) return;
  const b = rangeBounds();
  if (!b) return;
  if (b.r0 === b.r1 && b.c0 === b.c1 && active instanceof HTMLInputElement && active.selectionStart !== active.selectionEnd) return;
  const lines: string[] = [];
  for (let r = b.r0; r <= b.r1; r++) {
    const vals: string[] = [];
    for (let c = b.c0; c <= b.c1; c++) vals.push((cellInput(r, c) || { value: '' }).value);
    lines.push(vals.join('\t'));
  }
  e.clipboardData!.setData('text/plain', lines.join('\n'));
  e.preventDefault();
}

function onGridPaste(e: ClipboardEvent): void {
  if (!document.contains(gridBody)) return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !gridBody.contains(active)) return;
  const anchor = active instanceof HTMLInputElement ? cellIndexOf(active) : null;
  if (!anchor) return;
  const text: string = (e.clipboardData || (window as unknown as { clipboardData: DataTransfer }).clipboardData).getData('text/plain');
  if (!text) return;
  const rawLines = text.replace(/\r/g, '').split('\n');
  if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const grid = rawLines.map((line) => line.split('\t'));
  const isSingleValue = grid.length <= 1 && grid[0].length <= 1;
  if (isSingleValue && active instanceof HTMLInputElement && active.selectionStart !== active.selectionEnd) return;
  e.preventDefault();

  let maxCol = 0;
  grid.forEach((vals, rOffset) => {
    const def = draft[anchor.row + rOffset];
    if (!def) return; // clamped to existing rows
    vals.forEach((val, cOffset) => {
      const c = anchor.col + cOffset;
      if (c >= CELL_FIELDS.length) return;
      maxCol = Math.max(maxCol, c);
      (def as unknown as Record<string, string>)[CELL_FIELDS[c]] = val;
    });
  });

  selAnchor = anchor;
  selFocus = { row: Math.min(anchor.row + grid.length - 1, draft.length - 1), col: Math.min(maxCol, CELL_FIELDS.length - 1) };
  renderGrid();
  refreshSelectionHighlight();
}

function onModalKeydown(e: KeyboardEvent): void {
  if (!document.contains(gridBody)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const b = rangeBounds();
    if (!b || (b.r0 === b.r1 && b.c0 === b.c1)) return; // single/no cell - normal text editing
    e.preventDefault();
    for (let r = b.r0; r <= b.r1; r++) {
      const def = draft[r];
      if (!def) continue;
      for (let c = b.c0; c <= b.c1; c++) (def as unknown as Record<string, string>)[CELL_FIELDS[c]] = '';
    }
    renderGrid();
    refreshSelectionHighlight();
  }
}

function renderGrid(): void {
  gridBody.innerHTML = '';
  draft.forEach((def, idx) => gridBody.appendChild(renderRow(def, idx)));
}

function cleanupGridListeners(): void {
  document.removeEventListener('mouseup', onGridMouseUp);
  document.removeEventListener('copy', onGridCopy);
  document.removeEventListener('paste', onGridPaste);
  document.removeEventListener('keydown', onModalKeydown);
  selAnchor = null;
  selFocus = null;
}

function open(): void {
  draft = JSON.parse(JSON.stringify(state.data.systemColumns));

  const body = document.createElement('div');
  body.innerHTML =
    '<p class="hint">System columns are appended to every table (shown in yellow) - e.g. CREATED_BY, CREATED_DATE.</p>' +
    '<datalist id="col-type-datalist">' + dataTypeSuggestions(state.data.designMode).map((t) => '<option value="' + t + '">').join('') + '</datalist>' +
    '<table class="col-grid">' +
      '<thead><tr><th></th><th>#</th><th>Name</th><th>Comment</th><th>Data type</th><th>Default</th><th></th></tr></thead>' +
      '<tbody></tbody>' +
    '</table>' +
    '<button type="button" class="btn btn-add-sys">+ Add system column</button>';

  const table = body.querySelector('.col-grid') as HTMLTableElement;
  gridBody = table.querySelector('tbody')!;
  renderGrid();
  table.addEventListener('mousedown', onGridMouseDown);
  table.addEventListener('mouseover', onGridMouseOver);
  document.addEventListener('mouseup', onGridMouseUp);
  document.addEventListener('copy', onGridCopy);
  document.addEventListener('paste', onGridPaste);
  document.addEventListener('keydown', onModalKeydown);
  (body.querySelector('.btn-add-sys') as HTMLButtonElement).addEventListener('click', () => { draft.push(newDef()); renderGrid(); });

  modal.open({
    title: 'System columns',
    width: '640px',
    body,
    onClose: cleanupGridListeners,
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
