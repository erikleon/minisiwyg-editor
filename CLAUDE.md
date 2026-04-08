# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

minisiwyg-editor is a sub-5kb gzipped, zero-dependency WYSIWYG editor with security as a first-class architectural concern. Built on contentEditable with a declarative policy engine that enforces allowed HTML via MutationObserver.

## Architecture

Four independent exports, bottom-up dependency chain:

1. `minisiwyg-editor/sanitize` — DOM tree walker, whitelist-based HTML sanitizer
2. `minisiwyg-editor/policy` — MutationObserver wrapper, re-entrancy guard, tag normalization
3. `minisiwyg-editor` — contentEditable core, paste handler, execCommand wrapper
4. `minisiwyg-editor/toolbar` — optional UI with ARIA roles and keyboard navigation

Shared types in `src/types.ts`. Default policy in `src/defaults.ts`.

## Build and Test

```bash
npm run build          # esbuild: ESM + CJS output (minified)
npm test               # vitest with happy-dom
npx playwright test    # OWASP XSS vectors in real browsers
npm run size-check     # fails if dist/index.js (full bundle) > 5kb gzipped
npm run build:demo     # generates demo/index.html (gitignored, regenerate locally)
```

Run a single test file:
```bash
npx vitest run test/sanitize.test.ts
```

## Key Design Decisions

- **execCommand for v1** (deprecated but simple, observer normalizes browser-variant tags like b->strong)
- **Paste handler is the primary security boundary** (sanitize-before-insert via Selection/Range API)
- **MutationObserver is defense-in-depth** (fires after mutation, not before)
- **strip defaults to true** in DEFAULT_POLICY (removing disallowed tags entirely)
- **javascript: and data: URLs are hardcoded denials** (cannot be allowed via policy.protocols)
- **Toolbar uses CSS classes, not inline styles** (CSP-safe)
- **No insertHTML** — paste insertion uses Selection/Range API

## Security

OWASP XSS cheat sheet vectors are tested in both happy-dom (fast) and Playwright (real browsers). The sanitizer parses HTML via `<template>` element (no script execution), walks the DOM tree depth-first, and removes anything not in the whitelist.

## Size Budget

Total: ~4.3kb gzipped target (5kb hard limit enforced in CI).
- Sanitizer: ~1.2kb, Policy: ~0.8kb, Editor: ~1.5kb, Toolbar: ~0.8kb
