import { nextId } from './util';
import { Column, DdlFkCandidate, DdlParseResult, DdlTable } from './types';

// Lightweight regex/scanner based Oracle DDL reader. It intentionally only
// understands the handful of statement shapes needed for reverse-engineering
// an ERD (CREATE TABLE, COMMENT ON TABLE/COLUMN, ALTER TABLE ... FOREIGN KEY)
// and silently drops everything else (indexes, sequences, grants, storage
// clauses, views, triggers, partitioning, etc).

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function splitStatements(text: string): string[] {
  // naive split on ';' - adequate for DDL dumps where ';' inside string
  // literals essentially never occurs for table/column definitions.
  return text.split(';').map((s) => s.trim()).filter(Boolean);
}

function stripQuotes(name: string): string {
  if (!name) return name;
  return name.replace(/^"|"$/g, '');
}

function parseQualifiedName(raw: string): string {
  const parts = raw.split('.').map((p) => stripQuotes(p.trim()));
  return parts[parts.length - 1];
}

interface ParenGroup {
  inner: string;
  endIdx: number;
}

// Given a string and the index of an opening '(', returns the substring
// between the matching parens (exclusive) and the index just after the
// closing paren.
function extractParenGroup(str: string, openIdx: number): ParenGroup {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return { inner: str.slice(openIdx + 1, i), endIdx: i + 1 };
      }
    }
  }
  return { inner: str.slice(openIdx + 1), endIdx: str.length };
}

// Splits a clause list on top-level commas only (ignores commas nested
// inside parens, e.g. NUMBER(10,2)).
function splitTopLevel(str: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseColumnList(inner: string): string[] {
  return splitTopLevel(inner).map((s) => stripQuotes(s.trim()));
}

interface CreateTableResult {
  table: DdlTable;
  inlineFks: DdlFkCandidate[];
}

function parseCreateTable(stmt: string, tables: DdlTable[]): CreateTableResult | null {
  const m = stmt.match(/^CREATE\s+TABLE\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\(/i);
  if (!m) return null;
  const tableName = parseQualifiedName(m[1]);
  const openIdx = stmt.indexOf('(', m[0].length - 1);
  const group = extractParenGroup(stmt, openIdx);
  const clauses = splitTopLevel(group.inner);

  const columns: Column[] = [];
  const pkColumnNames: string[] = [];
  const inlineFks: DdlFkCandidate[] = [];

  clauses.forEach((clause) => {
    const c = clause.trim();
    if (!c) return;

    let cm: RegExpMatchArray | null;
    if ((cm = c.match(/^CONSTRAINT\s+(?:"[^"]+"|[\w$#]+)\s+PRIMARY\s+KEY\s*\(([^)]*)\)/i)) ||
        (cm = c.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i))) {
      parseColumnList(cm[1]).forEach((n) => pkColumnNames.push(n.toUpperCase()));
      return;
    }

    if ((cm = c.match(/^CONSTRAINT\s+(?:"[^"]+"|[\w$#]+)\s+FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\(([^)]*)\)/i)) ||
        (cm = c.match(/^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\(([^)]*)\)/i))) {
      inlineFks.push({
        table: tableName,
        columns: parseColumnList(cm[1]),
        refTable: parseQualifiedName(cm[2]),
        refColumns: parseColumnList(cm[3])
      });
      return;
    }

    if (/^CONSTRAINT\s+(?:"[^"]+"|[\w$#]+)\s+(UNIQUE|CHECK)\b/i.test(c) || /^(UNIQUE|CHECK)\b/i.test(c)) {
      return; // dropped: not relevant to ERD structure
    }

    // column definition: NAME TYPE(args) [DEFAULT ...] [NOT NULL] [ENABLE|DISABLE] ...
    const colMatch = c.match(/^"?([\w$#]+)"?\s+([A-Za-z][\w$#]*(?:\s*\([^)]*\))?)/);
    if (colMatch) {
      const name = colMatch[1];
      const dataType = colMatch[2].replace(/\s+/g, '');
      const nullable = !/NOT\s+NULL/i.test(c);
      columns.push({
        id: nextId('col'),
        name,
        dataType,
        comment: '',
        pk: false,
        fk: false,
        nullable,
        isSystem: false,
        systemColId: null
      });
    }
  });

  pkColumnNames.forEach((pkName) => {
    const col = columns.find((c) => c.name.toUpperCase() === pkName);
    if (col) { col.pk = true; col.nullable = false; }
  });

  let table = tables.find((t) => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table) {
    table = { name: tableName, comment: '', columns: [] };
    tables.push(table);
  }
  // dedup columns by name when the same table is declared more than once
  const existingNames = table.columns.map((c) => c.name.toUpperCase());
  columns.forEach((c) => {
    if (existingNames.indexOf(c.name.toUpperCase()) === -1) table!.columns.push(c);
  });

  return { table, inlineFks };
}

function parseCommentOnTable(stmt: string): { table: string; comment: string } | null {
  const m = stmt.match(/^COMMENT\s+ON\s+TABLE\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s+IS\s+'([\s\S]*)'$/i);
  if (!m) return null;
  return { table: parseQualifiedName(m[1]), comment: m[2].replace(/''/g, "'") };
}

function parseCommentOnColumn(stmt: string): { table: string; column: string; comment: string } | null {
  const m = stmt.match(/^COMMENT\s+ON\s+COLUMN\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\.("?[\w$#]+"?)\s+IS\s+'([\s\S]*)'$/i);
  if (!m) return null;
  return { table: parseQualifiedName(m[1]), column: stripQuotes(m[2]), comment: m[3].replace(/''/g, "'") };
}

function parseAlterTableFk(stmt: string): DdlFkCandidate | null {
  const m = stmt.match(/^ALTER\s+TABLE\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s+ADD\s+CONSTRAINT\s+(?:"[^"]+"|[\w$#]+)\s+FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\(([^)]*)\)/i);
  if (!m) return null;
  return {
    table: parseQualifiedName(m[1]),
    columns: parseColumnList(m[2]),
    refTable: parseQualifiedName(m[3]),
    refColumns: parseColumnList(m[4])
  };
}

export function parse(rawText: string): DdlParseResult {
  const warnings: string[] = [];
  const text = stripComments(rawText || '');
  const statements = splitStatements(text);

  const tables: DdlTable[] = [];
  const fkCandidates: DdlFkCandidate[] = [];

  statements.forEach((stmt) => {
    if (/^CREATE\s+TABLE\b/i.test(stmt)) {
      const res = parseCreateTable(stmt, tables);
      if (res && res.inlineFks.length) fkCandidates.push(...res.inlineFks);
      return;
    }
    if (/^COMMENT\s+ON\s+TABLE\b/i.test(stmt)) {
      const c = parseCommentOnTable(stmt);
      if (c) {
        const t = tables.find((t) => t.name.toUpperCase() === c.table.toUpperCase());
        if (t) t.comment = c.comment;
      }
      return;
    }
    if (/^COMMENT\s+ON\s+COLUMN\b/i.test(stmt)) {
      const c = parseCommentOnColumn(stmt);
      if (c) {
        const t = tables.find((t) => t.name.toUpperCase() === c.table.toUpperCase());
        const col = t && t.columns.find((col) => col.name.toUpperCase() === c.column.toUpperCase());
        if (col) col.comment = c.comment;
      }
      return;
    }
    if (/^ALTER\s+TABLE\b[\s\S]*FOREIGN\s+KEY\b/i.test(stmt)) {
      const fk = parseAlterTableFk(stmt);
      if (fk) fkCandidates.push(fk);
      else warnings.push('Unparsed FOREIGN KEY clause: ' + stmt.slice(0, 80));
      return;
    }
    // everything else (CREATE INDEX, CREATE SEQUENCE, CREATE OR REPLACE VIEW/TRIGGER,
    // GRANT, ALTER TABLE MODIFY/ENABLE/DISABLE, PARTITION BY, storage clauses...) is dropped.
  });

  const relations = [];
  for (const fk of fkCandidates) {
    if (!fk.columns.length || !fk.refColumns.length) continue;
    const srcTable = tables.find((t) => t.name.toUpperCase() === fk.table.toUpperCase());
    const dstTable = tables.find((t) => t.name.toUpperCase() === fk.refTable.toUpperCase());
    if (!srcTable || !dstTable) {
      warnings.push('Skipped FK referencing unknown table: ' + fk.table + ' -> ' + fk.refTable);
      continue;
    }
    const srcColName = fk.columns[0];
    const dstColName = fk.refColumns[0];
    if (fk.columns.length > 1) {
      warnings.push('Composite FK on ' + fk.table + ' simplified to first column pair (' + srcColName + ')');
    }

    const srcCol = srcTable.columns.find((c) => c.name.toUpperCase() === srcColName.toUpperCase());
    if (srcCol) srcCol.fk = true;

    relations.push({
      sourceTable: srcTable.name,
      sourceColumn: srcColName,
      targetTable: dstTable.name,
      targetColumn: dstColName,
      name: ''
    });
  }

  return { tables, relations, warnings };
}
