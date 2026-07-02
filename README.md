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

- **Visual entity editing** - add tables, edit columns via double-click, drag headers to reposition
- **Relationships** - drag a table body onto another to connect a relation, with crow's-foot cardinality and composite FK support
- **Logical / Physical modes** - toggle between logical and physical diagram views
- **DDL import** - parse existing `CREATE TABLE` DDL straight into the canvas
- **Export** - PNG (diagram snapshot), JSON (full diagram state), and per-table DDL
- **System columns** - apply common audit columns (created_at, updated_at, etc.) across tables
- **Fully offline** - no server, no network calls; opens directly from `file://`

## Setup

```
npm install
npm run build
```

Then open `index.html` directly in a browser - no server needed.

## Usage

- **Add a table** - click `+ Table`, then double-click the table to add/edit columns
- **Move a table** - drag its header
- **Connect a relation** - drag a table's body onto another table
- **Import DDL** - click `Import DDL` and paste `CREATE TABLE` statements
- **Export** - `Export PNG` for a snapshot, `Export JSON` to save/reload the full diagram
- **Switch views** - use the Logical/Physical toggle in the toolbar

## Scripts

- `npm run typecheck` - type-check only (`tsc --noEmit`)
- `npm run build` - type-check, then bundle `src/main.ts` into `dist/bundle.js`
- `npm run watch` - rebuild `dist/bundle.js` on every save

`dist/` is generated and not committed - run `npm run build` after cloning or pulling changes to `src/`.

