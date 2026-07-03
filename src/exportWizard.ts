import { state } from './state';
import { modal } from './modal';
import { escapeHtml, copyToClipboard, downloadDataUrl } from './util';
import { ddlExport, BulkDdlOptions } from './ddlExport';
import { pngExport } from './pngExport';
import { DbVendor, DB_VENDORS } from './ddlExtractSql';
import { ModalAction } from './types';

// Export counterpart to the Import DDL wizard - same Plan -> Execute ->
// Result shell (shared modal.transition animation, clickable completed step
// chips), branching on the chosen format:
//   PNG: Execute confirms scope -> Result previews the image + download.
//   SQL: Execute picks vendor/scope/options -> Result shows the DDL.

type WizardStep = 'plan' | 'execute' | 'result';
type Direction = 'left' | 'right';
type Format = 'png' | 'sql';

const STEP_LABELS: { key: WizardStep; label: string }[] = [
  { key: 'plan', label: '1. Plan' },
  { key: 'execute', label: '2. Execute' },
  { key: 'result', label: '3. Result' }
];

function stepsHtml(current: WizardStep): string {
  const idx = STEP_LABELS.findIndex((s) => s.key === current);
  return '<div class="wizard-steps">' + STEP_LABELS.map((s, i) => {
    const cls = i === idx ? 'active' : (i < idx ? 'done' : '');
    const sep = i < STEP_LABELS.length - 1 ? '<span class="wizard-step-sep">&rarr;</span>' : '';
    return '<span class="wizard-step ' + cls + '" data-step="' + s.key + '">' + s.label + '</span>' + sep;
  }).join('') + '</div>';
}

function open(): void {
  if (!state.data.entities.length) { window.alert('There are no tables to export.'); return; }

  let format: Format = 'sql';
  // SQL options carried across Back/Next so the Execute step keeps them.
  let vendor: DbVendor = 'oracle';
  let includeDrop = false;
  let includeFk = true;
  let owner = '';
  let ownerOn = false;
  let tablespace = '';
  let tablespaceOn = false;
  let indexTablespace = '';
  let indexTablespaceOn = false;
  let selectedIds: string[] = state.data.entities.map((e) => e.id);

  function wireStepNav(body: HTMLElement): void {
    (Array.from(body.querySelectorAll('.wizard-step.done')) as HTMLElement[]).forEach((chip) => {
      const step = chip.dataset.step as WizardStep;
      chip.addEventListener('click', () => {
        if (step === 'plan') renderPlan('right');
        else if (step === 'execute') renderExecute('right');
      });
    });
  }

  function bulkOptions(): BulkDdlOptions {
    return {
      vendor,
      owner: ownerOn ? owner.trim() || undefined : undefined,
      tablespace: tablespaceOn ? tablespace.trim() || undefined : undefined,
      indexTablespace: indexTablespaceOn ? indexTablespace.trim() || undefined : undefined,
      includeDrop,
      includeFk
    };
  }

  function renderPlan(direction: Direction = 'left'): void {
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('plan') +
      '<div class="wizard-plan-choices">' +
        '<label class="wizard-plan-card">' +
          '<input type="radio" name="f-export-format" value="sql"' + (format === 'sql' ? ' checked' : '') + '>' +
          '<div><strong>SQL (DDL) export</strong><p class="hint">Generate CREATE TABLE / constraint / comment statements for a chosen DB vendor.</p></div>' +
        '</label>' +
        '<label class="wizard-plan-card">' +
          '<input type="radio" name="f-export-format" value="png"' + (format === 'png' ? ' checked' : '') + '>' +
          '<div><strong>PNG image</strong><p class="hint">Render the current diagram to a downloadable PNG snapshot.</p></div>' +
        '</label>' +
      '</div>';

    (Array.from(body.querySelectorAll('input[name="f-export-format"]')) as HTMLInputElement[])
      .forEach((r) => r.addEventListener('change', () => { if (r.checked) format = r.value as Format; }));
    wireStepNav(body);

    modal.transition({
      title: 'Export',
      width: '640px',
      body,
      actions: [{ label: 'Next', variant: 'primary', onClick: () => renderExecute('left') }]
    }, direction);
  }

  function renderExecute(direction: Direction = 'left'): void {
    if (format === 'png') renderExecutePng(direction);
    else renderExecuteSql(direction);
  }

  function renderExecutePng(direction: Direction): void {
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('execute') +
      '<p class="hint">A PNG snapshot of the whole diagram (' + state.data.entities.length +
      ' table' + (state.data.entities.length === 1 ? '' : 's') + ') will be rendered at 2&times; resolution on a white background.</p>' +
      '<p class="hint">Continue to preview and download it.</p>';
    wireStepNav(body);

    modal.transition({
      title: 'Export',
      width: '640px',
      body,
      actions: [
        { label: 'Back', onClick: () => renderPlan('right') },
        { label: 'Next', variant: 'primary', onClick: () => renderResult('left') }
      ]
    }, direction);
  }

  function renderExecuteSql(direction: Direction): void {
    const entities = state.data.entities;
    const selected = new Set(selectedIds);
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('execute') +
      '<label class="ddl-export-vendor-row">DB vendor<select class="f-ddl-vendor">' +
        DB_VENDORS.map((v) => '<option value="' + v.value + '"' + (v.value === vendor ? ' selected' : '') + '>' + escapeHtml(v.label) + '</option>').join('') +
      '</select></label>' +
      '<label class="col-check-row ddl-export-fk-toggle"><input type="checkbox" class="f-ddl-include-drop"' + (includeDrop ? ' checked' : '') + '> Include DROP TABLE statements</label>' +
      '<label class="col-check-row ddl-export-fk-toggle"><input type="checkbox" class="f-ddl-include-fk"' + (includeFk ? ' checked' : '') + '> Include FK constraints (ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...)</label>' +
      '<div class="col-check-row ddl-export-fk-toggle ddl-export-ts-row">' +
        '<span class="ddl-export-ts-pair">' +
          '<label><input type="checkbox" class="f-ddl-include-owner"' + (ownerOn ? ' checked' : '') + '> Owner</label>' +
          '<input type="text" class="f-ddl-owner-input" placeholder="e.g. SCOTT" value="' + escapeHtml(owner) + '"' + (ownerOn ? '' : ' disabled') + '>' +
        '</span>' +
        '<span class="ddl-export-ts-pair">' +
          '<label><input type="checkbox" class="f-ddl-include-tablespace"' + (tablespaceOn ? ' checked' : '') + '> Tablespace</label>' +
          '<input type="text" class="f-ddl-tablespace-input" placeholder="e.g. USERS" value="' + escapeHtml(tablespace) + '"' + (tablespaceOn ? '' : ' disabled') + '>' +
        '</span>' +
        '<span class="ddl-export-ts-pair">' +
          '<label><input type="checkbox" class="f-ddl-include-idx-tablespace"' + (indexTablespaceOn ? ' checked' : '') + '> Index Tablespace</label>' +
          '<input type="text" class="f-ddl-idx-tablespace-input" placeholder="e.g. INDX" value="' + escapeHtml(indexTablespace) + '"' + (indexTablespaceOn ? '' : ' disabled') + '>' +
        '</span>' +
      '</div>' +
      '<div class="ddl-export-list">' +
        '<label class="col-check-row ddl-export-select-all"><input type="checkbox" class="f-ddl-select-all"> Select All</label>' +
        entities.map((e) =>
          '<label class="col-check-row"><input type="checkbox" class="f-ddl-check" value="' + e.id + '"' + (selected.has(e.id) ? ' checked' : '') + '> ' + escapeHtml(e.name) + '</label>'
        ).join('') +
      '</div>';

    const vendorSelect = body.querySelector('.f-ddl-vendor') as HTMLSelectElement;
    const dropToggle = body.querySelector('.f-ddl-include-drop') as HTMLInputElement;
    const fkToggle = body.querySelector('.f-ddl-include-fk') as HTMLInputElement;
    const ownerToggle = body.querySelector('.f-ddl-include-owner') as HTMLInputElement;
    const ownerInput = body.querySelector('.f-ddl-owner-input') as HTMLInputElement;
    const tsToggle = body.querySelector('.f-ddl-include-tablespace') as HTMLInputElement;
    const tsInput = body.querySelector('.f-ddl-tablespace-input') as HTMLInputElement;
    const idxToggle = body.querySelector('.f-ddl-include-idx-tablespace') as HTMLInputElement;
    const idxInput = body.querySelector('.f-ddl-idx-tablespace-input') as HTMLInputElement;
    const checks = Array.from(body.querySelectorAll('.f-ddl-check')) as HTMLInputElement[];
    const selectAll = body.querySelector('.f-ddl-select-all') as HTMLInputElement;

    function syncSelectAll(): void {
      const n = checks.filter((c) => c.checked).length;
      selectAll.checked = n === checks.length;
      selectAll.indeterminate = n > 0 && n < checks.length;
    }
    syncSelectAll();

    vendorSelect.addEventListener('change', () => { vendor = vendorSelect.value as DbVendor; });
    dropToggle.addEventListener('change', () => { includeDrop = dropToggle.checked; });
    fkToggle.addEventListener('change', () => { includeFk = fkToggle.checked; });
    ownerToggle.addEventListener('change', () => { ownerOn = ownerToggle.checked; ownerInput.disabled = !ownerOn; if (ownerOn) ownerInput.focus(); });
    ownerInput.addEventListener('input', () => { owner = ownerInput.value; });
    tsToggle.addEventListener('change', () => { tablespaceOn = tsToggle.checked; tsInput.disabled = !tablespaceOn; if (tablespaceOn) tsInput.focus(); });
    tsInput.addEventListener('input', () => { tablespace = tsInput.value; });
    idxToggle.addEventListener('change', () => { indexTablespaceOn = idxToggle.checked; idxInput.disabled = !indexTablespaceOn; if (indexTablespaceOn) idxInput.focus(); });
    idxInput.addEventListener('input', () => { indexTablespace = idxInput.value; });
    selectAll.addEventListener('change', () => {
      checks.forEach((c) => { c.checked = selectAll.checked; });
      selectAll.indeterminate = false;
      selectedIds = checks.filter((c) => c.checked).map((c) => c.value);
    });
    checks.forEach((c) => c.addEventListener('change', () => {
      syncSelectAll();
      selectedIds = checks.filter((x) => x.checked).map((x) => x.value);
    }));
    wireStepNav(body);

    modal.transition({
      title: 'Export',
      width: '820px',
      body,
      actions: [
        { label: 'Back', onClick: () => renderPlan('right') },
        { label: 'Next', variant: 'primary', onClick: () => {
          if (!selectedIds.length) { window.alert('Select at least one table to export.'); return; }
          renderResult('left');
        } }
      ]
    }, direction);
  }

  function renderResult(direction: Direction = 'left'): void {
    if (format === 'png') renderResultPng(direction);
    else renderResultSql(direction);
  }

  function renderResultPng(direction: Direction): void {
    const dataUrl = pngExport.renderDataUrl();
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('result') +
      (dataUrl
        ? '<p class="hint">Preview of the rendered diagram:</p>' +
          '<div class="export-png-preview"><img src="' + dataUrl + '" alt="Diagram preview"></div>'
        : '<p class="hint">Nothing to render.</p>');
    wireStepNav(body);

    const actions: ModalAction[] = [{ label: 'Back', onClick: () => renderExecute('right') }];
    if (dataUrl) actions.push({ label: 'Download PNG', variant: 'primary', onClick: () => downloadDataUrl(dataUrl, 'erd-diagram.png') });

    modal.transition({ title: 'Export', width: '700px', body, actions }, direction);
  }

  function renderResultSql(direction: Direction): void {
    const ddl = ddlExport.generateBulkDdl(selectedIds, bulkOptions());
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('result') +
      '<p class="hint">' + selectedIds.length + ' table(s), ' + DB_VENDORS.filter((v) => v.value === vendor)[0].label + ' dialect.</p>' +
      '<textarea class="f-ddl-output" rows="18" readonly></textarea>';
    (body.querySelector('.f-ddl-output') as HTMLTextAreaElement).value = ddl;
    wireStepNav(body);

    modal.transition({
      title: 'Export',
      width: '760px',
      body,
      actions: [
        { label: 'Back', onClick: () => renderExecute('right') },
        { label: 'Copy to clipboard', variant: 'primary', onClick: () => copyToClipboard(ddl) }
      ]
    }, direction);
  }

  renderPlan();
}

export const exportWizard = { open };
