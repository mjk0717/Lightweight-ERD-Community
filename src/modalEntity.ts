import { state } from './state';
import { modal } from './modal';
import { escapeHtml, nextId, ORACLE_TYPES } from './util';
import { Column, Entity } from './types';

let draft: Entity | null = null;
let gridBody: HTMLElement;
let dragIndex: number | null = null;

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

  const table = document.createElement('table');
  table.className = 'col-grid';
  table.innerHTML =
    '<thead><tr><th></th><th>#</th><th>Name</th><th>Comment</th><th>Data type</th><th>PK</th><th>Null</th><th>FK</th><th></th></tr></thead>' +
    '<tbody></tbody>';
  wrap.appendChild(table);
  gridBody = table.querySelector('tbody')!;
  renderGrid();

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

function open(entityId: string, opts?: { isNew?: boolean }): void {
  const entity = state.getEntity(entityId);
  if (!entity) return;
  const body = buildBody(entity);
  let resolved = false;

  modal.open({
    title: 'Table details',
    width: '720px',
    body,
    // If this entity was just created for the modal (e.g. from "+ Table")
    // and the user dismisses without saving (Cancel, Escape, backdrop click,
    // the X button), undo the creation instead of leaving a stray table.
    onClose: () => {
      if (opts?.isNew && !resolved) state.removeEntity(entityId);
    },
    actions: [
      { label: 'Delete table', variant: 'danger', onClick: () => { resolved = true; state.removeEntity(entity.id); modal.close(); } },
      { label: 'Cancel', onClick: () => { modal.close(); } },
      { label: 'Save', variant: 'primary', onClick: () => {
        resolved = true;
        const keptIds = new Set(draft!.columns.map((c) => c.id));
        state.data.relations = state.data.relations.filter((r) => {
          const breaksSource = r.sourceEntityId === entity.id && !keptIds.has(r.sourceColumnId);
          const breaksTarget = r.targetEntityId === entity.id && !keptIds.has(r.targetColumnId);
          return !(breaksSource || breaksTarget);
        });
        state.updateEntity(entity.id, { name: draft!.name, comment: draft!.comment, columns: draft!.columns });
        modal.close();
      } }
    ]
  });
}

export const modalEntity = { open };
