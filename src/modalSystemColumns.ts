import { state } from './state';
import { modal } from './modal';
import { escapeHtml } from './util';
import { SystemColumnDef } from './types';

let draft: SystemColumnDef[] = [];
let gridBody: HTMLElement;

function newDef(): SystemColumnDef {
  return { id: '', name: 'NEW_COLUMN', dataType: 'VARCHAR2(50)', comment: '' };
}

function renderRow(def: SystemColumnDef): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input type="text" class="f-name" value="' + escapeHtml(def.name) + '"></td>' +
    '<td><input type="text" class="f-type" value="' + escapeHtml(def.dataType) + '"></td>' +
    '<td><input type="text" class="f-comment" value="' + escapeHtml(def.comment || '') + '"></td>' +
    '<td><button type="button" class="btn-icon btn-del-sys" title="Remove">✕</button></td>';
  (tr.querySelector('.f-name') as HTMLInputElement).addEventListener('input', (e) => { def.name = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.f-type') as HTMLInputElement).addEventListener('input', (e) => { def.dataType = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.f-comment') as HTMLInputElement).addEventListener('input', (e) => { def.comment = (e.target as HTMLInputElement).value; });
  (tr.querySelector('.btn-del-sys') as HTMLButtonElement).addEventListener('click', () => {
    draft = draft.filter((d) => d !== def);
    renderGrid();
  });
  return tr;
}

function renderGrid(): void {
  gridBody.innerHTML = '';
  draft.forEach((def) => gridBody.appendChild(renderRow(def)));
}

function open(): void {
  draft = JSON.parse(JSON.stringify(state.data.systemColumns));

  const body = document.createElement('div');
  body.innerHTML =
    '<p class="hint">System columns are appended to every table (shown in yellow) - e.g. CREATED_BY, CREATED_DATE.</p>' +
    '<table class="col-grid sys-col-grid">' +
      '<thead><tr><th>Name</th><th>Data type</th><th>Comment</th><th></th></tr></thead>' +
      '<tbody></tbody>' +
    '</table>' +
    '<button type="button" class="btn btn-add-sys">+ Add system column</button>';

  gridBody = body.querySelector('tbody')!;
  renderGrid();
  (body.querySelector('.btn-add-sys') as HTMLButtonElement).addEventListener('click', () => { draft.push(newDef()); renderGrid(); });

  modal.open({
    title: 'System columns',
    width: '560px',
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
