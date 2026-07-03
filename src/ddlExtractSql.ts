export type DbVendor = 'oracle' | 'mysql' | 'postgres' | 'mssql';

export const DB_VENDORS: { value: DbVendor; label: string }[] = [
  { value: 'oracle', label: 'Oracle' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mssql', label: 'SQL Server' }
];

function schemaOf(schema: string): string {
  return schema.trim() || '<SCHEMA>';
}

// Each generator produces SQL to run against the *source* database's own
// catalog, not DDL itself - the user runs it there and pastes the resulting
// rows back into the box below. Every vendor's catalog exposes different
// DDL-reconstruction capabilities (Oracle's DBMS_METADATA can reproduce full
// CREATE TABLE text including constraints; the others have no equivalent
// single-call export), so each function shapes its own SQL instead of
// forcing one query style across vendors.
const GENERATORS: Record<DbVendor, (schema: string) => string> = {
  oracle(schema) {
    const s = schemaOf(schema);
    // Notes on the shape below:
    // - GET_DDL takes the owner as its 3rd argument, so tables owned by a
    //   schema other than the connected user still resolve (ORA-31603 otherwise).
    // - GET_DDL does NOT emit a statement terminator, so '|| ';'' appends one;
    //   without it the CREATE TABLE runs into the next row on import.
    // - Every branch is a CLOB (comment branches wrapped in TO_CLOB) because
    //   UNION ALL rejects mixing CLOB with VARCHAR2.
    // - No ordering column is needed: the importer applies COMMENT ON only
    //   after all tables are parsed, so row order doesn't matter.
    return `-- Run once. CREATE TABLE (with PK/FK/unique constraints) plus table and
-- column comments, each ';'-terminated so it pastes and imports cleanly.
SELECT DBMS_METADATA.GET_DDL('TABLE', TABLE_NAME, OWNER) || ';' AS ddl
FROM ALL_TABLES
WHERE OWNER = '${s}'
UNION ALL
SELECT TO_CLOB('COMMENT ON TABLE "' || OWNER || '"."' || TABLE_NAME || '" IS ''' || REPLACE(COMMENTS, '''', '''''') || ''';')
FROM ALL_TAB_COMMENTS
WHERE OWNER = '${s}' AND COMMENTS IS NOT NULL
UNION ALL
SELECT TO_CLOB('COMMENT ON COLUMN "' || OWNER || '"."' || TABLE_NAME || '"."' || COLUMN_NAME || '" IS ''' || REPLACE(COMMENTS, '''', '''''') || ''';')
FROM ALL_COL_COMMENTS
WHERE OWNER = '${s}' AND COMMENTS IS NOT NULL;`;
  },
  mysql(schema) {
    const s = schemaOf(schema);
    // MySQL has no GET_DDL and SHOW CREATE TABLE is a statement (not usable in
    // UNION ALL), so CREATE TABLE is reconstructed from INFORMATION_SCHEMA:
    // columns (+ inline PK), FKs as ALTER TABLE, then comments - one query.
    // NOTE: GROUP_CONCAT is capped by group_concat_max_len (default 1024); for
    // wide tables run  SET SESSION group_concat_max_len = 1000000;  first.
    return `-- Run once. Reconstructs CREATE TABLE + PK, then FK constraints, then
-- table/column comments, all combined with UNION ALL.
SELECT CONCAT('CREATE TABLE "', c.TABLE_NAME, '" (',
    GROUP_CONCAT(CONCAT('"', c.COLUMN_NAME, '" ', c.COLUMN_TYPE, IF(c.IS_NULLABLE = 'NO', ' NOT NULL', '')) ORDER BY c.ORDINAL_POSITION SEPARATOR ', '),
    COALESCE(MAX(pk.clause), ''), ');') AS ddl
FROM INFORMATION_SCHEMA.COLUMNS c
LEFT JOIN (
  SELECT TABLE_NAME,
    CONCAT(', CONSTRAINT "', TABLE_NAME, '_PK" PRIMARY KEY (',
      GROUP_CONCAT(CONCAT('"', COLUMN_NAME, '"') ORDER BY ORDINAL_POSITION SEPARATOR ', '), ')') AS clause
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = '${s}' AND CONSTRAINT_NAME = 'PRIMARY'
  GROUP BY TABLE_NAME
) pk ON pk.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = '${s}'
GROUP BY c.TABLE_NAME
UNION ALL
SELECT CONCAT('ALTER TABLE "', k.TABLE_NAME, '" ADD CONSTRAINT "', k.CONSTRAINT_NAME, '" FOREIGN KEY (',
    GROUP_CONCAT(CONCAT('"', k.COLUMN_NAME, '"') ORDER BY k.ORDINAL_POSITION SEPARATOR ', '),
    ') REFERENCES "', MAX(k.REFERENCED_TABLE_NAME), '" (',
    GROUP_CONCAT(CONCAT('"', k.REFERENCED_COLUMN_NAME, '"') ORDER BY k.ORDINAL_POSITION SEPARATOR ', '), ');')
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
WHERE k.TABLE_SCHEMA = '${s}' AND k.REFERENCED_TABLE_NAME IS NOT NULL
GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME
UNION ALL
SELECT CONCAT('COMMENT ON TABLE "', TABLE_NAME, '" IS ''', REPLACE(TABLE_COMMENT, '''', ''''''), ''';')
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = '${s}' AND TABLE_COMMENT <> ''
UNION ALL
SELECT CONCAT('COMMENT ON COLUMN "', TABLE_NAME, '"."', COLUMN_NAME, '" IS ''', REPLACE(COLUMN_COMMENT, '''', ''''''), ''';')
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '${s}' AND COLUMN_COMMENT <> '';`;
  },
  postgres(schema) {
    const s = schemaOf(schema);
    // No single DDL function, so CREATE TABLE is reconstructed from the
    // catalog (columns via format_type + inline PK), FKs as ALTER TABLE, then
    // comments - one UNION ALL query. For a byte-exact dump, pg_dump is still
    // the gold standard:  pg_dump --schema-only --no-owner -n ${s} <database>
    return `-- Run once. Reconstructs CREATE TABLE + PK, then FK constraints, then
-- table/column comments, all combined with UNION ALL.
SELECT 'CREATE TABLE "' || c.relname || '" (' ||
    string_agg('"' || a.attname || '" ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ', ' ORDER BY a.attnum) ||
    COALESCE((SELECT ', CONSTRAINT "' || c.relname || '_PK" PRIMARY KEY (' ||
        string_agg('"' || pa.attname || '"', ', ' ORDER BY u.ord) || ')'
      FROM pg_constraint pc
      JOIN unnest(pc.conkey) WITH ORDINALITY u(attnum, ord) ON true
      JOIN pg_attribute pa ON pa.attrelid = pc.conrelid AND pa.attnum = u.attnum
      WHERE pc.contype = 'p' AND pc.conrelid = c.oid), '') || ');' AS ddl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = '${s}' AND c.relkind = 'r'
GROUP BY c.oid, c.relname
UNION ALL
SELECT 'ALTER TABLE "' || cl.relname || '" ADD CONSTRAINT "' || pc.conname || '" FOREIGN KEY (' ||
    (SELECT string_agg('"' || pa.attname || '"', ', ' ORDER BY u.ord)
     FROM unnest(pc.conkey) WITH ORDINALITY u(attnum, ord) JOIN pg_attribute pa ON pa.attrelid = pc.conrelid AND pa.attnum = u.attnum) ||
    ') REFERENCES "' || rf.relname || '" (' ||
    (SELECT string_agg('"' || pa.attname || '"', ', ' ORDER BY u.ord)
     FROM unnest(pc.confkey) WITH ORDINALITY u(attnum, ord) JOIN pg_attribute pa ON pa.attrelid = pc.confrelid AND pa.attnum = u.attnum) || ');'
FROM pg_constraint pc
JOIN pg_class cl ON cl.oid = pc.conrelid
JOIN pg_class rf ON rf.oid = pc.confrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE pc.contype = 'f' AND n.nspname = '${s}'
UNION ALL
SELECT 'COMMENT ON TABLE "' || c.relname || '" IS ''' || replace(d.description, '''', '''''') || ''';'
FROM pg_class c
JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${s}'
UNION ALL
SELECT 'COMMENT ON COLUMN "' || c.relname || '"."' || a.attname || '" IS ''' || replace(d.description, '''', '''''') || ''';'
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid
JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${s}';`;
  },
  mssql(schema) {
    const s = schemaOf(schema);
    // No single DDL function, so CREATE TABLE is reconstructed from
    // INFORMATION_SCHEMA / sys (columns + inline PK), FKs as ALTER TABLE, then
    // MS_Description comments - one UNION ALL query. Requires STRING_AGG (SQL
    // Server 2017+); SSMS > Tasks > Generate Scripts is still the exact route.
    return `-- Run once. Reconstructs CREATE TABLE + PK, then FK constraints, then
-- table/column comments, all combined with UNION ALL.
SELECT 'CREATE TABLE "' + c.TABLE_NAME + '" (' +
    STRING_AGG(CAST('"' + c.COLUMN_NAME + '" ' + c.DATA_TYPE +
        CASE
          WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN '(MAX)'
          WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR(12)) + ')'
          WHEN c.DATA_TYPE IN ('decimal','numeric') THEN '(' + CAST(c.NUMERIC_PRECISION AS VARCHAR(12)) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR(12)) + ')'
          ELSE ''
        END +
        CASE WHEN c.IS_NULLABLE = 'NO' THEN ' NOT NULL' ELSE '' END AS NVARCHAR(MAX)), ', ')
      WITHIN GROUP (ORDER BY c.ORDINAL_POSITION) +
    ISNULL((SELECT ', CONSTRAINT "' + c.TABLE_NAME + '_PK" PRIMARY KEY (' +
        STRING_AGG(CAST('"' + ku.COLUMN_NAME + '"' AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY ku.ORDINAL_POSITION) + ')'
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = ku.CONSTRAINT_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND ku.TABLE_SCHEMA = '${s}' AND ku.TABLE_NAME = c.TABLE_NAME), '') + ');' AS ddl
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = '${s}'
GROUP BY c.TABLE_NAME
UNION ALL
SELECT 'ALTER TABLE "' + tp.name + '" ADD CONSTRAINT "' + fk.name + '" FOREIGN KEY (' +
    STRING_AGG(CAST('"' + cp.name + '"' AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) +
    ') REFERENCES "' + tr.name + '" (' +
    STRING_AGG(CAST('"' + cr.name + '"' AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) + ');'
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables tp ON tp.object_id = fk.parent_object_id
JOIN sys.tables tr ON tr.object_id = fk.referenced_object_id
JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
WHERE SCHEMA_NAME(tp.schema_id) = '${s}'
GROUP BY tp.name, fk.name, tr.name
UNION ALL
SELECT 'COMMENT ON TABLE "' + t.name + '" IS ''' + REPLACE(CAST(ep.value AS NVARCHAR(MAX)), '''', '''''') + ''';'
FROM sys.tables t
JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE SCHEMA_NAME(t.schema_id) = '${s}'
UNION ALL
SELECT 'COMMENT ON COLUMN "' + t.name + '"."' + c.name + '" IS ''' + REPLACE(CAST(ep.value AS NVARCHAR(MAX)), '''', '''''') + ''';'
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
WHERE SCHEMA_NAME(t.schema_id) = '${s}';`;
  }
};

export function generateExtractSql(vendor: DbVendor, schema: string): string {
  return (GENERATORS[vendor] || GENERATORS.oracle)(schema);
}
