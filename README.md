# ERD Editor

Offline-capable HTML ERD editor. TypeScript sources in `src/`, bundled with esbuild into `dist/bundle.js`, which `index.html` loads via a plain `<script>` tag (no ES modules, so it also runs from `file://` with no server).

## Setup

```
npm install
npm run build
```

Then open `index.html` directly in a browser - no server needed.

## Scripts

- `npm run typecheck` - type-check only (`tsc --noEmit`)
- `npm run build` - type-check, then bundle `src/main.ts` into `dist/bundle.js`
- `npm run watch` - rebuild `dist/bundle.js` on every save

`dist/` is generated and not committed - run `npm run build` after cloning or pulling changes to `src/`.

## Branching

Trunk-based, no `develop`/`release` branches:

- `main` is always kept in a working state.
- Each fix or feature gets its own short-lived branch off `main`: `fix/<name>` or `feat/<name>`.
- Merge back into `main` and delete the branch once done; avoid letting branches live long enough to drift.
- Tag notable working states with `vX.Y.Z` (e.g. `git tag v1.1.0 && git push origin v1.1.0`) so a known-good point can be recovered later.
