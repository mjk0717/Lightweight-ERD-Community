import { state } from './state';
import { modal } from './modal';
import { nextId, readFileAsText, escapeHtml } from './util';
import { parse } from './ddlParser';
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

function open(): void {
  const body = document.createElement('div');
  body.innerHTML =
    '<p class="hint">Paste an Oracle DDL dump (CREATE TABLE / COMMENT ON / ALTER TABLE ... FOREIGN KEY), or load a .sql file. Indexes, sequences, grants and other clutter are ignored automatically; duplicate table definitions are merged.</p>' +
    '<input type="file" class="f-ddl-file" accept=".sql,.txt">' +
    '<textarea class="f-ddl-text" rows="14" placeholder="CREATE TABLE ..."></textarea>' +
    '<div class="ddl-warnings"></div>';

  const fileInput = body.querySelector('.f-ddl-file') as HTMLInputElement;
  const textarea = body.querySelector('.f-ddl-text') as HTMLTextAreaElement;
  const warningsEl = body.querySelector('.ddl-warnings') as HTMLElement;

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    readFileAsText(file).then((text) => { textarea.value = text; });
  });

  modal.open({
    title: 'Reverse engineer from Oracle DDL',
    width: '760px',
    body,
    actions: [
      { label: 'Close', onClick: () => modal.close() },
      { label: 'Parse & import', variant: 'primary', onClick: () => {
        const result = parse(textarea.value, state.data.entities.map((e) => e.name));
        if (!result.tables.length && !result.relations.length && !result.pkUpdates.length) {
          warningsEl.innerHTML = '<div class="warn-line">No CREATE TABLE statements were recognized.</div>';
          return;
        }
        const summary = importParsedResult(result);
        const lines = ['Imported ' + summary.tableCount + ' table(s) and ' + summary.relationCount + ' relation(s).'];
        lines.push(...result.warnings);
        warningsEl.innerHTML = lines.map((l) => '<div class="warn-line">' + escapeHtml(l) + '</div>').join('');
      } }
    ]
  });
}

export const ddlImport = { open, importParsedResult };
