import { state } from './state';
import { modal } from './modal';
import { escapeHtml, nextId, ORACLE_TYPES } from './util';
import { HEADER_COLOR_PALETTE, theme } from './theme';
import { Column, Entity } from './types';

let draft: Entity | null = null;
let gridBody: HTMLElement;
let dragIndex: number | null = null;

// Excel-like range selection/copy-paste over the grid's text columns (row
// reordering has its own drag handle, so this only spans Name/Comment/Data
// type - the columns that are genuinely free-text).
type CellField = 'name' | 'comment' | 'dataType';
const CELL_FIELDS: CellField[] = ['name', 'comment', 'dataType'];
const CELL_CLASSES = ['f-name', 'f-comment', 'f-type'];
interface CellIdx { row: number; col: number; }
let selAnchor: CellIdx | null = null;
let selFocus: CellIdx | null = null;
let isSelecting = false;

function newColumn(): Column {
  return { id: nextId('col'), name: 'NEW_COLUMN', dataType: 'VARCHAR2(50)', comment: '', pk: false, fk: false, nullable: true, isSystem: false, systemColId: null };
}

function renderRow(col: Column, idx: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'col-row' + (col.isSystem ? ' col-row-system' : '');
  tr.innerHTML =
    '<td class="col-handle-cell"><span class="drag-handle" title="Drag to reorder">⋮⋮</span></td>' +
    '<td class="col-order">' + (idx + 1) + '</td>' +
    '<td><input type="text" class="f-name" value="' + escapeHtml(col.name) + '" ' + (col.isSystem ? 'disabled' : '') + '></td>' +
    '<td><input type="text" class="f-comment" value="' + escapeHtml(col.comment || '') + '" ' + (col.isSystem ? 'disabled' : '') + '></td>' +
    '<td><input type="text" class="f-type" list="oracle-types-datalist" value="' + escapeHtml(col.dataType) + '" ' + (col.isSystem ? 'disabled' : '') + '></td>' +
    '<td class="col-check"><input type="checkbox" class="f-pk" ' + (col.pk ? 'checked' : '') + '></td>' +
    '<td class="col-check"><input type="checkbox" class="f-null" ' + (col.nullable ? 'checked' : '') + '></td>' +
    '<td class="col-check">' + (col.fk ? '<span class="badge-fk">FK</span>' : '') + '</td>' +
    '<td>' + (col.isSystem ? '<span class="hint">system</span>' : '<button type="button" class="btn-icon btn-del-col" title="Delete column">✕</button>') + '</td>';

  const nameInput = tr.querySelector('.f-name') as HTMLInputElement | null;
  if (nameInput) nameInput.addEventListener('input', (e) => { col.name = (e.target as HTMLInputElement).value; });
  const commentInput = tr.querySelector('.f-comment') as HTMLInputElement | null;
  if (commentInput) commentInput.addEventListener('input', (e) => { col.comment = (e.target as HTMLInputElement).value; });
  const typeInput = tr.querySelector('.f-type') as HTMLInputElement | null;
  if (typeInput) typeInput.addEventListener('input', (e) => { col.dataType = (e.target as HTMLInputElement).value; });

  (tr.querySelector('.f-pk') as HTMLInputElement).addEventListener('change', (e) => {
    col.pk = (e.target as HTMLInputElement).checked;
    if (col.pk) col.nullable = false;
    renderGrid();
  });
  (tr.querySelector('.f-null') as HTMLInputElement).addEventListener('change', (e) => { col.nullable = (e.target as HTMLInputElement).checked; });

  const delBtn = tr.querySelector('.btn-del-col') as HTMLButtonElement | null;
  if (delBtn) delBtn.addEventListener('click', () => {
    draft!.columns = draft!.columns.filter((c) => c.id !== col.id);
    renderGrid();
  });

  const handle = tr.querySelector('.drag-handle') as HTMLElement;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragIndex = idx;
    tr.classList.add('dragging');
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  });

  return tr;
}

function onDragMove(e: MouseEvent): void {
  if (dragIndex === null || !draft) return;
  const rows = Array.prototype.slice.call(gridBody.querySelectorAll('tr')) as HTMLElement[];
  const overRow = rows.find((r) => {
    const rect = r.getBoundingClientRect();
    return e.clientY >= rect.top && e.clientY <= rect.bottom;
  });
  if (!overRow) return;
  const overIndex = rows.indexOf(overRow);
  if (overIndex === -1 || overIndex === dragIndex) return;
  const moved = draft.columns.splice(dragIndex, 1)[0];
  draft.columns.splice(overIndex, 0, moved);
  dragIndex = overIndex;
  renderGrid();
}

function onDragEnd(): void {
  dragIndex = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

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

function onGridMouseUp(): void {
  isSelecting = false;
}

// Only take over the clipboard for a genuine multi-cell range - a single
// selected cell keeps the browser's normal text-selection copy/paste so the
// user can still copy a partial string out of one field.
function onGridCopy(e: ClipboardEvent): void {
  if (!document.contains(gridBody)) return;
  const active = document.activeElement;
  if (!active || !gridBody.contains(active)) return;
  const b = rangeBounds();
  if (!b || (b.r0 === b.r1 && b.c0 === b.c1)) return;
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
  if (!document.contains(gridBody) || !draft) return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !gridBody.contains(active)) return;
  const anchor = active instanceof HTMLInputElement ? cellIndexOf(active) : null;
  if (!anchor) return;
  const text: string = (e.clipboardData || (window as any).clipboardData).getData('text/plain');
  if (!text) return;
  const rawLines = text.replace(/\r/g, '').split('\n');
  if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const grid = rawLines.map((line) => line.split('\t'));
  // A single plain value (no tabs/newlines) isn't a range paste - leave it
  // to the browser's normal single-field paste.
  if (grid.length <= 1 && grid[0].length <= 1) return;
  e.preventDefault();

  let maxCol = 0;
  grid.forEach((vals, rOffset) => {
    const row = anchor.row + rOffset;
    const col = draft!.columns[row];
    if (!col || col.isSystem) return; // clamped to existing, non-system rows
    vals.forEach((val, cOffset) => {
      const c = anchor.col + cOffset;
      if (c >= CELL_FIELDS.length) return;
      maxCol = Math.max(maxCol, c);
      (col as any)[CELL_FIELDS[c]] = val;
    });
  });

  selAnchor = anchor;
  selFocus = { row: Math.min(anchor.row + grid.length - 1, draft.columns.length - 1), col: Math.min(maxCol, CELL_FIELDS.length - 1) };
  renderGrid();
  refreshSelectionHighlight();
}

function renderGrid(): void {
  gridBody.innerHTML = '';
  draft!.columns.forEach((col, idx) => gridBody.appendChild(renderRow(col, idx)));
}

function buildBody(entity: Entity): HTMLElement {
  draft = JSON.parse(JSON.stringify(entity));
  const wrap = document.createElement('div');

  const datalist = document.createElement('datalist');
  datalist.id = 'oracle-types-datalist';
  datalist.innerHTML = ORACLE_TYPES.map((t) => '<option value="' + t + '">').join('');
  wrap.appendChild(datalist);

  const head = document.createElement('div');
  head.className = 'entity-modal-head';
  head.innerHTML =
    '<label>Table name<br><input type="text" class="f-entity-name" value="' + escapeHtml(draft!.name) + '"></label>' +
    '<label>Comment<br><input type="text" class="f-entity-comment" value="' + escapeHtml(draft!.comment || '') + '"></label>';
  (head.querySelector('.f-entity-name') as HTMLInputElement).addEventListener('input', (e) => { draft!.name = (e.target as HTMLInputElement).value; });
  (head.querySelector('.f-entity-comment') as HTMLInputElement).addEventListener('input', (e) => { draft!.comment = (e.target as HTMLInputElement).value; });
  wrap.appendChild(head);

  const palette = document.createElement('div');
  palette.className = 'header-color-palette';
  function renderPalette(): void {
    palette.innerHTML = '<span class="hint">Header color</span>';
    HEADER_COLOR_PALETTE.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch' + ((draft!.headerColor || theme.colors.headerBg) === color ? ' selected' : '');
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener('click', () => { draft!.headerColor = color; renderPalette(); });
      palette.appendChild(swatch);
    });
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'color-swatch color-swatch-reset' + (!draft!.headerColor ? ' selected' : '');
    resetBtn.title = 'Default';
    resetBtn.textContent = '✕';
    resetBtn.addEventListener('click', () => { draft!.headerColor = null; renderPalette(); });
    palette.appendChild(resetBtn);
  }
  renderPalette();
  wrap.appendChild(palette);

  const table = document.createElement('table');
  table.className = 'col-grid';
  table.innerHTML =
    '<thead><tr><th></th><th>#</th><th>Name</th><th>Comment</th><th>Data type</th><th>PK</th><th>Null</th><th>FK</th><th></th></tr></thead>' +
    '<tbody></tbody>';
  wrap.appendChild(table);
  gridBody = table.querySelector('tbody')!;
  renderGrid();
  table.addEventListener('mousedown', onGridMouseDown);
  table.addEventListener('mouseover', onGridMouseOver);
  document.addEventListener('mouseup', onGridMouseUp);
  document.addEventListener('copy', onGridCopy);
  document.addEventListener('paste', onGridPaste);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-add-col';
  addBtn.textContent = '+ Add column';
  addBtn.addEventListener('click', () => {
    // New columns always land above system columns, never mixed in below them.
    const firstSystemIdx = draft!.columns.findIndex((c) => c.isSystem);
    const insertAt = firstSystemIdx === -1 ? draft!.columns.length : firstSystemIdx;
    draft!.columns.splice(insertAt, 0, newColumn());
    renderGrid();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

// The grid's copy/paste listeners live on document (so paste works even
// when a checkbox or button, not a text input, currently has focus) - must
// be torn down when the modal closes or they'd pile up across re-opens.
function cleanupGridListeners(): void {
  document.removeEventListener('mouseup', onGridMouseUp);
  document.removeEventListener('copy', onGridCopy);
  document.removeEventListener('paste', onGridPaste);
  selAnchor = null;
  selFocus = null;
}

function open(entityId: string): void {
  const entity = state.getEntity(entityId);
  if (!entity) return;
  const body = buildBody(entity);

  modal.open({
    title: 'Table details',
    width: '720px',
    body,
    onClose: cleanupGridListeners,
    actions: [
      { label: 'Delete table', variant: 'danger', onClick: () => { state.removeEntity(entity.id); modal.close(); } },
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Save', variant: 'primary', onClick: () => {
        const keptIds = new Set(draft!.columns.map((c) => c.id));
        state.data.relations = state.data.relations
          .map((r) => {
            if (r.sourceEntityId !== entity.id && r.targetEntityId !== entity.id) return r;
            const columnPairs = r.columnPairs.filter((p) =>
              (r.sourceEntityId !== entity.id || keptIds.has(p.sourceColumnId)) &&
              (r.targetEntityId !== entity.id || keptIds.has(p.targetColumnId))
            );
            return { ...r, columnPairs };
          })
          .filter((r) => r.columnPairs.length > 0);
        state.updateEntity(entity.id, { name: draft!.name, comment: draft!.comment, columns: draft!.columns, headerColor: draft!.headerColor });
        modal.close();
      } }
    ]
  });
}

// Used by "Create Entity/Table": shows the same editor for a table that
// doesn't exist in state yet. Nothing is created until Save is clicked;
// Cancel/Escape/the backdrop simply discard the template with no state
// change at all.
function openNew(template: Entity): void {
  const body = buildBody(template);

  modal.open({
    title: 'Table details',
    width: '720px',
    body,
    onClose: cleanupGridListeners,
    actions: [
      { label: 'Cancel', onClick: () => modal.close() },
      { label: 'Save', variant: 'primary', onClick: () => {
        state.addEntity({ ...draft! });
        modal.close();
      } }
    ]
  });
}

export const modalEntity = { open, openNew };
