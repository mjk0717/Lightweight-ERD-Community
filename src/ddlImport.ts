import { state } from './state';
import { modal } from './modal';
import { nextId, readFileAsText, escapeHtml, copyToClipboard } from './util';
import { parse } from './ddlParser';
import { DbVendor, DB_VENDORS, generateExtractSql } from './ddlExtractSql';
import { DEFAULT_SOURCE_CARDINALITY, DEFAULT_TARGET_CARDINALITY } from './cardinality';
import { Column, DdlParseResult, Entity, RelationColumnPair } from './types';

interface ImportSummary {
  tableCount: number;
  relationCount: number;
}

function importParsedResult(result: DdlParseResult): ImportSummary {
  const nameToEntityId: Record<string, string> = {};
  state.data.entities.forEach((e) => { nameToEntityId[e.name.toUpperCase()] = e.id; });

  result.tables.forEach((table) => {
    const upper = table.name.toUpperCase();
    const existingId = nameToEntityId[upper];
    const columns: Column[] = table.columns.map((c) => Object.assign({}, c, { isSystem: false, systemColId: null }));
    if (existingId) {
      const entity = state.getEntity(existingId)!;
      entity.name = table.name;
      entity.comment = table.comment || entity.comment;
      entity.columns = columns;
      state.applySystemColumnsToEntity(entity);
    } else {
      const pos = state.nextEntityPosition();
      const entity: Entity = { id: nextId('ent'), name: table.name, comment: table.comment || '', x: pos.x, y: pos.y, columns, headerColor: null };
      state.applySystemColumnsToEntity(entity);
      state.addEntity(entity);
      nameToEntityId[upper] = entity.id;
    }
  });

  result.pkUpdates.forEach((upd) => {
    const entityId = nameToEntityId[upd.table.toUpperCase()];
    if (!entityId) return;
    const entity = state.getEntity(entityId)!;
    upd.columns.forEach((colName) => {
      const col = entity.columns.find((c) => c.name.toUpperCase() === colName.toUpperCase());
      if (col) { col.pk = true; col.nullable = false; }
    });
  });

  let created = 0;
  result.relations.forEach((rel) => {
    const sourceId = nameToEntityId[rel.sourceTable.toUpperCase()];
    const targetId = nameToEntityId[rel.targetTable.toUpperCase()];
    if (!sourceId || !targetId) return;
    const sourceEntity = state.getEntity(sourceId)!;
    const targetEntity = state.getEntity(targetId)!;

    const columnPairs: RelationColumnPair[] = [];
    for (let i = 0; i < rel.sourceColumns.length; i++) {
      const sourceCol = sourceEntity.columns.find((c) => c.name.toUpperCase() === rel.sourceColumns[i].toUpperCase());
      const targetCol = targetEntity.columns.find((c) => c.name.toUpperCase() === rel.targetColumns[i].toUpperCase());
      if (!sourceCol || !targetCol) { columnPairs.length = 0; break; }
      columnPairs.push({ sourceColumnId: sourceCol.id, targetColumnId: targetCol.id });
    }
    if (!columnPairs.length) return;
    if (state.relationExistsWithPairs(columnPairs)) return;
    // Freshly-parsed source tables already have fk:true set by the parser
    // (it mutates its own local Column objects) - for a source table that
    // already existed in the app (see parse()'s existingTableNames), there
    // was no local column to mark, so it's set here instead.
    columnPairs.forEach((p) => { const c = sourceEntity.columns.find((c) => c.id === p.sourceColumnId); if (c) c.fk = true; });

    state.addRelation({
      id: nextId('rel'), name: rel.name || '', logicalName: '',
      sourceEntityId: sourceId, targetEntityId: targetId, columnPairs,
      sourceCardinality: DEFAULT_SOURCE_CARDINALITY, targetCardinality: DEFAULT_TARGET_CARDINALITY
    });
    created++;
  });

  state.emit('change');
  return { tableCount: result.tables.length, relationCount: created };
}

type WizardStep = 'plan' | 'execute' | 'result';
type Direction = 'left' | 'right';

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

// A three-step wizard (Plan -> Execute -> Result), all driven from one
// closure so state (chosen mode, pasted/loaded DDL text, parse result)
// survives Back/Next navigation between steps. Each step swaps into the
// modal via modal.transition() (a slide left when advancing, right when
// going back - including jumping back several steps at once by clicking an
// earlier, already-completed step chip) rather than modal.open(), so the
// step change animates instead of instantly replacing the modal.
function open(): void {
  let mode: 'sql' | 'file' = 'sql';
  let vendor: DbVendor = 'oracle';
  let schema = '';
  let ddlText = '';
  let parseResult: DdlParseResult | null = null;
  let applied = false;
  let appliedRelationCount = 0;

  // Only steps already passed (rendered with the "done" chip) are wired up -
  // the active step's own chip and any not-yet-reached step do nothing.
  function wireStepNav(body: HTMLElement): void {
    const chips = Array.from(body.querySelectorAll('.wizard-step.done')) as HTMLElement[];
    chips.forEach((chip) => {
      const step = chip.dataset.step as WizardStep;
      chip.addEventListener('click', () => goToStep(step));
    });
  }

  function goToStep(step: WizardStep): void {
    if (step === 'plan') renderPlan('right');
    else if (step === 'execute') renderExecute('right');
  }

  function renderPlan(direction: Direction = 'left'): void {
    const body = document.createElement('div');
    // The choices are the action: each card is a button that both picks the
    // mode and advances to Execute, so the Plan step needs no Next button.
    body.innerHTML =
      stepsHtml('plan') +
      '<div class="wizard-plan-choices">' +
        '<button type="button" class="wizard-plan-card" data-mode="sql">' +
          '<div><strong>DDL SQL Import</strong><p class="hint">Generate a catalog-extraction SQL script for your DB vendor, run it there, then paste the resulting DDL text.</p></div>' +
          '<span class="wizard-plan-arrow">&rarr;</span>' +
        '</button>' +
        '<button type="button" class="wizard-plan-card" data-mode="file">' +
          '<div><strong>File Import</strong><p class="hint">Choose or drag &amp; drop a .sql/.txt file that already contains DDL statements.</p></div>' +
          '<span class="wizard-plan-arrow">&rarr;</span>' +
        '</button>' +
      '</div>';

    (Array.from(body.querySelectorAll('.wizard-plan-card')) as HTMLElement[]).forEach((card) => {
      card.addEventListener('click', () => { mode = card.dataset.mode as 'sql' | 'file'; renderExecute('left'); });
    });
    wireStepNav(body);

    modal.transition({ title: 'Reverse Engineering', width: '640px', body, actions: [] }, direction);
  }

  function renderExecuteSql(direction: Direction = 'left'): void {
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('execute') +
      '<div class="ddl-extract-controls">' +
        '<label>DB vendor<br><select class="f-extract-vendor">' +
          DB_VENDORS.map((v) => '<option value="' + v.value + '"' + (v.value === vendor ? ' selected' : '') + '>' + escapeHtml(v.label) + '</option>').join('') +
        '</select></label>' +
        '<label>Schema / owner<br><input type="text" class="f-extract-schema" placeholder="e.g. APP_OWNER" value="' + escapeHtml(schema) + '"></label>' +
        '<button type="button" class="btn f-extract-copy">Copy SQL</button>' +
      '</div>' +
      '<textarea class="f-extract-sql" rows="9" readonly></textarea>' +
      '<p class="hint">Run the SQL above against your database, then paste the resulting DDL text below.</p>' +
      '<textarea class="f-ddl-text" rows="9" placeholder="CREATE TABLE ...">' + escapeHtml(ddlText) + '</textarea>' +
      '<div class="ddl-warnings"></div>';

    const vendorSelect = body.querySelector('.f-extract-vendor') as HTMLSelectElement;
    const schemaInput = body.querySelector('.f-extract-schema') as HTMLInputElement;
    const extractSqlEl = body.querySelector('.f-extract-sql') as HTMLTextAreaElement;
    const copyBtn = body.querySelector('.f-extract-copy') as HTMLButtonElement;
    const textarea = body.querySelector('.f-ddl-text') as HTMLTextAreaElement;
    const warningsEl = body.querySelector('.ddl-warnings') as HTMLElement;

    function updateSql(): void { extractSqlEl.value = generateExtractSql(vendor, schema); }
    updateSql();

    vendorSelect.addEventListener('change', () => { vendor = vendorSelect.value as DbVendor; updateSql(); });
    schemaInput.addEventListener('input', () => { schema = schemaInput.value; updateSql(); });
    copyBtn.addEventListener('click', () => copyToClipboard(extractSqlEl.value));
    textarea.addEventListener('input', () => { ddlText = textarea.value; });
    wireStepNav(body);

    modal.transition({
      title: 'Reverse Engineering',
      width: '820px',
      body,
      actions: [
        { label: 'Back', onClick: () => renderPlan('right') },
        { label: 'Next', variant: 'primary', onClick: () => tryParseAndAdvance(warningsEl) }
      ]
    }, direction);
  }

  function renderExecuteFile(direction: Direction = 'left'): void {
    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('execute') +
      '<div class="ddl-dropzone">' +
        '<p>Drag &amp; drop a .sql/.txt file here, or</p>' +
        '<button type="button" class="btn f-dropzone-browse">Choose file</button>' +
        '<input type="file" class="f-ddl-file" accept=".sql,.txt" style="display:none">' +
        '<p class="hint f-dropzone-filename"></p>' +
      '</div>' +
      '<textarea class="f-ddl-text" rows="12" placeholder="File contents will appear here - you can also edit directly">' + escapeHtml(ddlText) + '</textarea>' +
      '<div class="ddl-warnings"></div>';

    const dropzone = body.querySelector('.ddl-dropzone') as HTMLElement;
    const browseBtn = body.querySelector('.f-dropzone-browse') as HTMLButtonElement;
    const fileInput = body.querySelector('.f-ddl-file') as HTMLInputElement;
    const filenameEl = body.querySelector('.f-dropzone-filename') as HTMLElement;
    const textarea = body.querySelector('.f-ddl-text') as HTMLTextAreaElement;
    const warningsEl = body.querySelector('.ddl-warnings') as HTMLElement;

    function loadFile(file: File): void {
      readFileAsText(file).then((text) => {
        ddlText = text;
        textarea.value = text;
        filenameEl.textContent = 'Loaded: ' + file.name;
      });
    }

    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) loadFile(file);
    });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
    textarea.addEventListener('input', () => { ddlText = textarea.value; });
    wireStepNav(body);

    modal.transition({
      title: 'Reverse Engineering',
      width: '700px',
      body,
      actions: [
        { label: 'Back', onClick: () => renderPlan('right') },
        { label: 'Next', variant: 'primary', onClick: () => tryParseAndAdvance(warningsEl) }
      ]
    }, direction);
  }

  function renderExecute(direction: Direction = 'left'): void {
    if (mode === 'sql') renderExecuteSql(direction);
    else renderExecuteFile(direction);
  }

  function tryParseAndAdvance(warningsEl: HTMLElement): void {
    if (!ddlText.trim()) {
      warningsEl.innerHTML = '<div class="warn-line">Paste or load some DDL text first.</div>';
      return;
    }
    const result = parse(ddlText, state.data.entities.map((e) => e.name));
    if (!result.tables.length && !result.relations.length && !result.pkUpdates.length) {
      warningsEl.innerHTML = '<div class="warn-line">No CREATE TABLE statements were recognized.</div>';
      return;
    }
    parseResult = result;
    applied = false;
    renderResult('left');
  }

  function renderResult(direction: Direction = 'left', animate: boolean = true): void {
    const result = parseResult!;
    const tableItems = result.tables.map((t) =>
      '<li class="import-result-item">' + escapeHtml(t.name) +
      ' <span class="hint">(' + t.columns.length + ' column' + (t.columns.length === 1 ? '' : 's') + ')</span></li>'
    ).join('');
    const relationItems = result.relations.map((r) =>
      '<li class="import-result-item">' + escapeHtml(r.sourceTable) + '.' + escapeHtml(r.sourceColumns.join(', ')) +
      ' &rarr; ' + escapeHtml(r.targetTable) + '.' + escapeHtml(r.targetColumns.join(', ')) +
      (r.name ? ' <span class="hint">(' + escapeHtml(r.name) + ')</span>' : '') + '</li>'
    ).join('');

    const body = document.createElement('div');
    body.innerHTML =
      stepsHtml('result') +
      '<p class="hint">' + (applied
        ? 'Imported ' + result.tables.length + ' table(s) and ' + appliedRelationCount + ' relation(s).'
        : 'Review what will be imported, then choose Apply.') + '</p>' +
      '<div class="import-result-section"><h4>Tables (' + result.tables.length + ')</h4>' +
        (tableItems ? '<ul class="import-result-list">' + tableItems + '</ul>' : '<p class="hint">None</p>') +
      '</div>' +
      '<div class="import-result-section"><h4>Constraints / relations (' + result.relations.length + ')</h4>' +
        (relationItems ? '<ul class="import-result-list">' + relationItems + '</ul>' : '<p class="hint">None</p>') +
      '</div>' +
      (result.warnings.length
        ? '<div class="ddl-warnings">' + result.warnings.map((w) => '<div class="warn-line">' + escapeHtml(w) + '</div>').join('') + '</div>'
        : '');
    wireStepNav(body);

    const opts = {
      title: 'Reverse Engineering',
      width: '700px',
      body,
      actions: applied
        ? [{ label: 'Close', variant: 'primary' as const, onClick: () => modal.close() }]
        : [
            { label: 'Back', onClick: () => renderExecute('right') },
            { label: 'Apply', variant: 'primary' as const, onClick: () => {
              const summary = importParsedResult(result);
              appliedRelationCount = summary.relationCount;
              applied = true;
              // Applying doesn't change step - just refreshes this step's
              // content in place, so it shouldn't slide like a real step change.
              renderResult('left', false);
            } }
          ]
    };
    if (animate) modal.transition(opts, direction);
    else modal.open(opts);
  }

  renderPlan();
}

export const ddlImport = { open, importParsedResult };
