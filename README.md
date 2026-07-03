# Lightweight-ERD

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![No server needed](https://img.shields.io/badge/runs%20from-file%3A%2F%2F-success)](#setup)

Offline-capable HTML ERD editor. TypeScript sources in `src/`, bundled with esbuild into `dist/bundle.js`, which `index.html` loads via a plain `<script>` tag (no ES modules, so it also runs from `file://` with no server).

![Lightweight-ERD screenshot](image.png)

<!--
  Screenshot/GIF checklist (replace the placeholder above once captured):
  1. npm run build
  2. Open index.html in a browser, build a small sample diagram (2-3 tables + relations)
  3. Screenshot -> save as docs/screenshot.png
  4. Record a short interaction (add table, drag to connect, toggle Logical/Physical) with
     ScreenToGif (Windows, https://www.screentogif.com/) -> save as docs/demo.gif
  5. Add `![Lightweight-ERD demo](docs/demo.gif)` under the Features section below
-->

## Features

- **Visual entity editing** - create tables from the right-click canvas menu, edit columns via double-click, drag headers to reposition
- **Excel-like column grid** - click-drag to select a range of cells, copy/paste (including multi-cell), Delete to clear a selection, drag rows to reorder
- **Relationships** - drag a table body onto another to connect a relation, with crow's-foot/IE cardinality (grouped One/Many picker), composite (multi-column) FK support, and identifying vs. non-identifying (solid/dashed) lines derived from PK status
- **Draggable relation endpoints** - once a relation is selected, drag either end anywhere along its entity's own border to reposition it visually, independent of the underlying FK column; self-referencing (hierarchical) relations render as a clean loop/arc instead of a kinked line
- **Relation highlighting** - clicking a relation highlights the exact parent/child columns it connects
- **Logical / Physical modes** - toggle between business-friendly names/comments and physical table/column names
- **Header color palette** - right-click a table (or open its details) to pick a header color
- **DDL import** - parses `CREATE TABLE`, `COMMENT ON`, and `ALTER TABLE ... ADD CONSTRAINT` (including the multi-constraint `ADD ( ... )` form) statements, correctly wiring FKs even when the referenced tables were imported separately earlier
- **Export** - PNG (diagram snapshot), bulk or per-table DDL (with an option to include FK constraints), and JSON (full diagram state) for reload/backup
- **System columns** - define common audit columns (created_at, updated_at, etc.) and apply them across every table
- **Undo/redo** - app-wide Ctrl+Z/Ctrl+Y covering every canvas action, persisted across page refreshes; the table details editor also has its own scoped undo/redo for in-progress edits before Save
- **Fully offline** - no server, no network calls; opens directly from `file://`

## Setup

```
npm install
npm run build
```

Then open `index.html` directly in a browser - no server needed.

## Usage

- **Add a table** - right-click empty canvas and choose `Create Entity/Table`, then double-click the table to add/edit columns
- **Move a table** - drag its header
- **Connect a relation** - drag a table's body onto another table (or back onto itself for a self-referencing relation)
- **Reposition a relation endpoint** - click the relation to select it, then drag either end's handle along its entity's border
- **Edit columns like a spreadsheet** - click-drag across cells to select a range, then copy/paste or Delete as usual
- **Import DDL** - click `Import DDL` and paste `CREATE TABLE`/`ALTER TABLE` statements
- **Export** - `Export PNG` for a snapshot, `Export DDL` for bulk or per-table DDL, `Export JSON` to save/reload the full diagram
- **Undo/redo** - `Ctrl+Z` / `Ctrl+Y` (or the toolbar buttons) while working on the canvas
- **Switch views** - use the Logical/Physical toggle in the toolbar

## Scripts

- `npm run typecheck` - type-check only (`tsc --noEmit`)
- `npm run build` - type-check, then bundle `src/main.ts` into `dist/bundle.js`
- `npm run watch` - rebuild `dist/bundle.js` on every save

`dist/` is generated and not committed - run `npm run build` after cloning or pulling changes to `src/`.

