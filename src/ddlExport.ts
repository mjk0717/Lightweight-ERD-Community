import { state } from './state';
import { modal } from './modal';
import { escapeHtml, copyToClipboard } from './util';
import { DbVendor } from './ddlExtractSql';
import { Column, Entity, Relation } from './types';

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

export interface DdlGenOptions {
  vendor?: DbVendor;
  owner?: string;
  tablespace?: string;
  indexTablespace?: string;
}

// Identifier quoting is the one syntax difference that touches every
// generated statement - Oracle/PostgreSQL both use ANSI double quotes,
// MySQL uses backticks, SQL Server uses brackets.
function quoteIdentifier(name: string, vendor: DbVendor): string {
  if (vendor === 'mysql') return '`' + name + '`';
  if (vendor === 'mssql') return '[' + name + ']';
  return '"' + name + '"';
}

function qualifiedTableName(name: string, vendor: DbVendor, owner?: string): string {
  return (owner ? quoteIdentifier(owner, vendor) + '.' : '') + quoteIdentifier(name, vendor);
}

// TABLESPACE is understood as-is by Oracle, PostgreSQL, and MySQL (InnoDB
// general tablespaces); SQL Server has no TABLESPACE keyword - its nearest
// equivalent is assigning the table to a filegroup via ON.
function tablespaceClause(name: string, vendor: DbVendor): string {
  return vendor === 'mssql' ? '\nON [' + name + ']' : '\nTABLESPACE ' + name;
}

// Per-index tablespace placement for the PK constraint - Oracle/PostgreSQL
// both support USING INDEX TABLESPACE verbatim; SQL Server again uses ON
// with a filegroup; MySQL has no per-index tablespace at the constraint
// level, only whole-table, so there's nothing to add here.
function indexTablespaceClause(name: string, vendor: DbVendor): string {
  if (vendor === 'mysql') return '';
  if (vendor === 'mssql') return ' ON [' + name + ']';
  return ' USING INDEX TABLESPACE ' + name;
}

// SQL Server has no COMMENT ON statement - table/column descriptions are
// stored as an MS_Description extended property via this system procedure
// instead. Schema defaults to dbo when no owner is set, matching SQL
// Server's own default schema.
function mssqlDescriptionProperty(schema: string, tableName: string, columnName: string | undefined, comment: string): string {
  const lines = [
    'EXEC sp_addextendedproperty @name = N\'MS_Description\', @value = N\'' + escapeSqlString(comment) + '\',',
    '  @level0type = N\'SCHEMA\', @level0name = ' + quoteIdentifier(schema, 'mssql') + ',',
    '  @level1type = N\'TABLE\', @level1name = ' + quoteIdentifier(tableName, 'mssql') + (columnName ? ',' : ';')
  ];
  if (columnName) lines.push('  @level2type = N\'COLUMN\', @level2name = ' + quoteIdentifier(columnName, 'mssql') + ';');
  return lines.join('\n');
}

function tableCommentStatement(entity: Entity, vendor: DbVendor, owner: string | undefined, qualifiedName: string): string | null {
  if (!entity.comment) return null;
  if (vendor === 'mssql') return mssqlDescriptionProperty(owner || 'dbo', entity.name, undefined, entity.comment);
  return 'COMMENT ON TABLE ' + qualifiedName + ' IS \'' + escapeSqlString(entity.comment) + '\';';
}

function columnCommentStatement(entity: Entity, col: Column, vendor: DbVendor, owner: string | undefined, qualifiedName: string): string | null {
  if (!col.comment) return null;
  if (vendor === 'mssql') return mssqlDescriptionProperty(owner || 'dbo', entity.name, col.name, col.comment);
  return 'COMMENT ON COLUMN ' + qualifiedName + '.' + quoteIdentifier(col.name, vendor) + ' IS \'' + escapeSqlString(col.comment) + '\';';
}

// Generates a CREATE TABLE ... COMMENT ON ... script for one entity -
// intentionally just that range (no ALTER TABLE / FK constraints), matching
// what a reverse-engineered dump's per-table section usually looks like.
// MySQL has no COMMENT ON statement, so its table/column comments are
// folded inline into the CREATE TABLE instead of appended as separate
// statements the way Oracle/PostgreSQL/SQL Server's are.
function generateDdl(entity: Entity, opts?: DdlGenOptions): string {
  const vendor: DbVendor = opts?.vendor || 'oracle';
  const isMySql = vendor === 'mysql';
  const qualifiedName = qualifiedTableName(entity.name, vendor, opts?.owner);

  const colLines = entity.columns.map((c) => {
    let line = '  ' + quoteIdentifier(c.name, vendor) + ' ' + c.dataType + (c.nullable ? '' : ' NOT NULL');
    if (isMySql && c.comment) line += ' COMMENT \'' + escapeSqlString(c.comment) + '\'';
    return line;
  });
  const pkCols = entity.columns.filter((c) => c.pk);
  if (pkCols.length) {
    let pkLine = '  CONSTRAINT ' + quoteIdentifier(entity.name + '_PK', vendor) + ' PRIMARY KEY (' + pkCols.map((c) => quoteIdentifier(c.name, vendor)).join(', ') + ')';
    if (opts?.indexTablespace) pkLine += indexTablespaceClause(opts.indexTablespace, vendor);
    colLines.push(pkLine);
  }

  let tableEnd = ')';
  if (opts?.tablespace) tableEnd += tablespaceClause(opts.tablespace, vendor);
  if (isMySql && entity.comment) tableEnd += ' COMMENT=\'' + escapeSqlString(entity.comment) + '\'';
  tableEnd += ';';
  const statements = ['CREATE TABLE ' + qualifiedName + ' (\n' + colLines.join(',\n') + '\n' + tableEnd];

  if (!isMySql) {
    const tableComment = tableCommentStatement(entity, vendor, opts?.owner, qualifiedName);
    if (tableComment) statements.push(tableComment);
    entity.columns.forEach((c) => {
      const colComment = columnCommentStatement(entity, c, vendor, opts?.owner, qualifiedName);
      if (colComment) statements.push(colComment);
    });
  }

  return statements.join('\n\n');
}

// DROP TABLE ... for one entity - kept separate from generateDdl() since drop
// export is opt-in (the bulk export's "Include DROP TABLE" checkbox).
function generateDropTableDdl(entity: Entity, vendor: DbVendor, owner?: string): string {
  return 'DROP TABLE ' + qualifiedTableName(entity.name, vendor, owner) + ';';
}

// ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ... for one
// relation - kept separate from generateDdl() since FK export is opt-in
// (the bulk export's "Include FK constraints" checkbox).
function generateFkConstraintDdl(relation: Relation, sourceEntity: Entity, targetEntity: Entity, vendor: DbVendor, owner?: string): string {
  const sourceCols = relation.columnPairs.map((p) => sourceEntity.columns.find((c) => c.id === p.sourceColumnId)).filter((c): c is Column => !!c);
  const targetCols = relation.columnPairs.map((p) => targetEntity.columns.find((c) => c.id === p.targetColumnId)).filter((c): c is Column => !!c);
  const constraintName = relation.name || (sourceEntity.name + '_' + targetEntity.name + '_FK');
  return 'ALTER TABLE ' + qualifiedTableName(sourceEntity.name, vendor, owner) + ' ADD CONSTRAINT ' + quoteIdentifier(constraintName, vendor) + ' FOREIGN KEY (' +
    sourceCols.map((c) => quoteIdentifier(c.name, vendor)).join(', ') + ') REFERENCES ' + qualifiedTableName(targetEntity.name, vendor, owner) + ' (' +
    targetCols.map((c) => quoteIdentifier(c.name, vendor)).join(', ') + ');';
}

export interface BulkDdlOptions extends DdlGenOptions {
  includeDrop: boolean;
  includeFk: boolean;
}

// Combined DDL for a chosen set of entities, in the same per-table order
// used everywhere else: optional DROP, then CREATE/comments, then that
// table's outgoing FK constraints (only to other selected tables). Shared
// by the Export wizard's SQL path - the wizard owns the options UI, this
// owns the SQL assembly.
function generateBulkDdl(entityIds: string[], opts: BulkDdlOptions): string {
  const selected = new Set(entityIds);
  const entities = state.data.entities.filter((e) => selected.has(e.id));
  const parts: string[] = [];
  entities.forEach((e) => {
    if (opts.includeDrop) parts.push(generateDropTableDdl(e, opts.vendor || 'oracle', opts.owner));
    parts.push(generateDdl(e, opts));
    if (opts.includeFk) {
      state.data.relations.forEach((r) => {
        if (r.sourceEntityId !== e.id || !selected.has(r.targetEntityId)) return;
        const tgt = state.getEntity(r.targetEntityId);
        if (tgt) parts.push(generateFkConstraintDdl(r, e, tgt, opts.vendor || 'oracle', opts.owner));
      });
    }
  });
  return parts.join('\n\n');
}

function open(entityId: string): void {
  const entity = state.getEntity(entityId);
  if (!entity) return;
  const ddl = generateDdl(entity);

  const body = document.createElement('div');
  body.innerHTML =
    '<p class="hint">' + escapeHtml(entity.name) + ' as CREATE TABLE / COMMENT statements.</p>' +
    '<textarea class="f-ddl-output" rows="18" readonly></textarea>';
  (body.querySelector('.f-ddl-output') as HTMLTextAreaElement).value = ddl;

  modal.open({
    title: 'DDL - ' + entity.name,
    width: '700px',
    body,
    actions: [
      { label: 'Close', onClick: () => modal.close() },
      { label: 'Copy to clipboard', variant: 'primary', onClick: () => copyToClipboard(ddl) }
    ]
  });
}

export const ddlExport = { open, generateDdl, generateBulkDdl };
