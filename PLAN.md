# minisiwyg-editor — Engineering Implementation Plan

## Context

Building a sub-5kb gzipped, zero-dependency WYSIWYG editor with security as a first-class architectural concern. The sanitizer is built INTO the editor via a declarative policy engine, not bolted on as a dependency. Spiritual successor to Pell (~1.2kb, 12k GitHub stars, abandoned with known XSS vulnerabilities).

Design doc: `~/.gstack/projects/minisiwyg-editor/erik-no-branch-design-20260328-144036.md`

## Architecture

```
                    ┌─────────────────────────────────┐
                    │        minisiwyg-editor/toolbar       │
                    │   (optional, ~0.8kb gzipped)     │
                    │  buttons, ARIA, keyboard nav,    │
                    │  link prompt via window.prompt()  │
                    └──────────────┬──────────────────┘
                                   │ calls editor.exec()
                    ┌──────────────▼──────────────────┐
                    │        minisiwyg-editor (core)        │
                    │   (~1.5kb gzipped)               │
                    │  contentEditable, paste handler,  │
                    │  execCommand wrapper, events      │
                    └──────────┬───────────────────────┘
                               │ consumes
              ┌────────────────▼────────────────┐
              │       minisiwyg-editor/policy         │
              │   (~0.8kb gzipped)               │
              │  MutationObserver, re-entrancy   │
              │  guard, tag normalization,        │
              │  JSON-serializable rules          │
              └────────────────┬────────────────┘
                               │ uses
              ┌────────────────▼────────────────┐
              │      minisiwyg-editor/sanitize        │
              │   (~1.2kb gzipped)               │
              │  DOM tree walker, whitelist       │
              │  check, <template> parsing,       │
              │  protocol validation              │
              └─────────────────────────────────┘
```

**Data flow on user input:**

```
User types/pastes
    │
    ▼
contentEditable fires input/paste event
    │
    ├── [paste] → intercept, parse via <template>,
    │             sanitize through policy, insert clean HTML
    │
    ├── [execCommand] → browser mutates DOM
    │                    │
    │                    ▼
    │              MutationObserver fires
    │                    │
    │                    ▼
    │              Policy engine checks mutations
    │                    │
    │                    ├── [allowed] → keep, normalize tags (b→strong, i→em)
    │                    │
    │                    └── [disallowed] → disconnect observer,
    │                                       remove node, reconnect
    │
    └── [direct typing] → MutationObserver catches any
                          injected content (defense in depth)
```

## Review Decisions

- **Build tool:** esbuild (single Go binary, zero JS deps). Handles TypeScript, ESM/CJS, subpath exports natively.
- **Test framework:** Vitest + happy-dom for unit tests. Playwright for OWASP browser tests.
- **Shared types:** `src/types.ts` for `SanitizePolicy` interface (breaks circular dependency).
- **All 8 test gaps covered:** empty policy, malformed policy, observer exception recovery, execCommand failure, invalid element, unknown command, zero toolbar actions, full E2E editing session.
- **Paste performance:** Document limitation for large pastes. Defer chunked processing.
- **Security model (from outside voice):** MutationObserver is defense-in-depth, NOT the primary security boundary. The paste handler (sanitize-before-insert) is the real wall. Marketing should say "XSS prevented at every entry point" not "architecturally impossible."
- **strip default:** `DEFAULT_POLICY.strip = true` (outside voice flagged this as a potential CVE if false).
- **CSP:** Toolbar uses CSS classes, not inline styles. Provide a stylesheet users can include.
- **Size budget:** 5kb is the FULL bundle (all 4 exports combined). Individual exports are smaller.
- **insertHTML:** NOT used anywhere. Paste uses Selection/Range API for insertion.
- **Playwright primary:** OWASP security tests run in real browsers via Playwright as the primary security test surface. happy-dom tests are supplementary for speed.

## File Structure

```
minisiwyg-editor/
├── src/
│   ├── sanitize.ts       — DOM tree walker, whitelist engine
│   ├── policy.ts         — SanitizePolicy interface, MutationObserver wrapper
│   ├── editor.ts         — contentEditable core, paste handler, execCommand
│   ├── toolbar.ts        — optional UI, ARIA, keyboard nav
│   ├── defaults.ts       — default policy (allowed tags/attrs/protocols)
│   ├── types.ts          — SanitizePolicy interface, shared types
│   └── index.ts          — re-exports for main entry point
├── test/
│   ├── sanitize.test.ts  — OWASP vectors, edge cases
│   ├── policy.test.ts    — MutationObserver enforcement, re-entrancy
│   ├── editor.test.ts    — paste handling, formatting, integration
│   ├── toolbar.test.ts   — ARIA, keyboard nav, actions
│   └── xss-vectors.ts    — shared XSS test payloads from OWASP cheat sheet
├── package.json          — exports map, build scripts, size budget
├── tsconfig.json
├── esbuild.config.ts     — esbuild config for ESM/CJS/subpath exports
├── .github/
│   └── workflows/
│       └── ci.yml        — test, build, size check, publish
├── demo/
│   └── index.html        — single-file demo (inline IIFE, no build step)
├── LICENSE
├── README.md
└── CLAUDE.md
```

## Daily Atomic Commits (10 Days)

Each day = one branch, one PR-ready commit, all tests passing.

---

### Day 1: Project Scaffolding

**Branch:** `chore/project-scaffolding`

**Commit:** `chore: initialize project with TypeScript, build pipeline, and CI`

**Files created:**
- `package.json` — name, version 0.1.0, exports map with subpath exports (`./sanitize`, `./policy`, `./toolbar`), scripts (build, test, size-check), `"type": "module"`, engines, repository, license. DevDependencies: `typescript`, `vitest`, `happy-dom`, `playwright` (for OWASP browser tests)
- `tsconfig.json` — strict mode, ES2020 target, declaration files, sourceMap
- `esbuild.config.ts` — esbuild configuration for 4 entry points (sanitize, policy, editor, toolbar), ESM + CJS output, TypeScript compilation. esbuild is a single Go binary with zero JS dependencies.
- `.github/workflows/ci.yml` — Node 20, install, test (vitest), test:browser (playwright), build, size check (`gzip -c dist/minisiwyg-editor.esm.js | wc -c` must be < 5120 bytes)
- `src/index.ts` — placeholder export
- `src/types.ts` — `SanitizePolicy` interface
- `src/defaults.ts` — `DEFAULT_POLICY` object with the standard whitelist
- `vitest.config.ts` — happy-dom environment, test file patterns
- `LICENSE` — MIT
- `CLAUDE.md` — build/test/lint commands for future agent sessions
- `.gitignore` — dist/, node_modules/, coverage/

**Size check script in package.json:**
```json
"size-check": "node -e \"const fs=require('fs');const {execSync}=require('child_process');const size=execSync('gzip -c dist/minisiwyg-editor.esm.js').length;console.log(size+' bytes gzipped');if(size>5120){process.exit(1)}\""
```

**Tests:** Build succeeds, size check script runs (passes trivially on placeholder), CI workflow is valid YAML.

**Verification:** `npm run build && npm test && npm run size-check`

---

### Day 2: Sanitizer Module

**Branch:** `feature/sanitizer`

**Commit:** `feat: add whitelist-based HTML sanitizer with DOM tree walking`

**Files created/modified:**
- `src/sanitize.ts` — core sanitizer implementation:
  - `sanitize(html: string, policy: SanitizePolicy): string` — main export
  - Uses `<template>` element to parse HTML (no script execution)
  - Depth-first DOM tree walk
  - Removes nodes not in `policy.tags` whitelist
  - Removes attributes not in per-tag attribute whitelist
  - Validates URL protocols on `href`, `src`, `action` attributes
  - Hardcoded denial of `javascript:` and `data:` protocols
  - Tag normalization: `<b>` -> `<strong>`, `<i>` -> `<em>`
  - `maxDepth` enforcement (strip nodes exceeding depth limit)
  - `maxLength` enforcement on textContent (truncate)
  - `strip` mode: true = remove node+children, false = unwrap (keep text content)
- `src/types.ts` — already created in Day 1, `SanitizePolicy` interface is already defined
- `src/defaults.ts` — update `DEFAULT_POLICY` with full tag/attribute whitelist

**Tests:** `test/sanitize.test.ts` —
- Basic allowed tags pass through unchanged
- Disallowed tags are stripped
- Attributes not in whitelist are removed
- Tag normalization works (b->strong, i->em)
- Empty input returns empty string
- Text-only input passes through
- Nested tags maintain structure when allowed
- maxDepth enforcement works
- strip vs unwrap mode works correctly
- Empty policy object (all tags stripped, only text remains)
- Null/undefined HTML input returns empty string

**Verification:** `npm test -- test/sanitize.test.ts`

---

### Day 3: Sanitizer Security Tests (OWASP)

**Branch:** `feat/sanitizer-security-tests`

**Commit:** `test: add OWASP XSS vector test suite for sanitizer`

**Files created/modified:**
- `test/xss-vectors.ts` — shared array of XSS payloads:
  - `<script>alert(1)</script>` — basic script injection
  - `<img src=x onerror=alert(1)>` — event handler attribute
  - `<a href="javascript:alert(1)">` — javascript: protocol
  - `<a href="data:text/html,<script>alert(1)</script>">` — data: protocol
  - `<svg onload=alert(1)>` — SVG namespace
  - `<math><mi>x</mi></math>` — MathML namespace
  - `<div style="background:url(javascript:alert(1))">` — CSS URL injection
  - `<img src="x" onerror="alert(1)" />` — self-closing with event
  - `<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)">` — HTML entity encoding
  - `<a href="%6A%61%76%61%73%63%72%69%70%74:alert(1)">` — URL encoding
  - `<iframe src="javascript:alert(1)">` — iframe injection
  - `<object data="javascript:alert(1)">` — object injection
  - `<embed src="javascript:alert(1)">` — embed injection
  - `<form action="javascript:alert(1)">` — form action
  - `<input onfocus=alert(1) autofocus>` — autofocus trigger
  - `<details open ontoggle=alert(1)>` — details ontoggle
  - `<body onload=alert(1)>` — body onload
  - `<marquee onstart=alert(1)>` — marquee
  - Deeply nested tags (50 levels) — maxDepth test
  - Mixed case: `<ScRiPt>alert(1)</ScRiPt>`
  - Null bytes: `<scri\x00pt>alert(1)</script>`
  - Extra whitespace: `<a href = " javascript:alert(1) ">`
- `test/sanitize.test.ts` — add security test suite:
  - For each vector: sanitize with DEFAULT_POLICY, verify no dangerous content remains
  - Test that `javascript:` is blocked even when policy.protocols includes it (hardcoded denial)
  - Test that `data:` URLs are always blocked
  - Test that event handler attributes (on*) are always stripped
  - Paste-payload-specific tests (HTML from Word, Google Docs, etc.)

- `test/sanitize.browser.test.ts` — Playwright tests running OWASP vectors in real Chrome/Firefox/Safari
  - Same vectors as `test/xss-vectors.ts` but executed in real browser DOM
  - Validates that `<template>` parsing + sanitizer behaves identically across browsers
  - Tests paste simulation with XSS payloads via Playwright clipboard API
- `playwright.config.ts` — configure Chromium + Firefox for OWASP tests

**Tests:** All OWASP vectors produce safe output in both happy-dom AND real browsers. Zero false negatives.

**Verification:** `npm test -- test/sanitize.test.ts && npx playwright test`

---

### Day 4: Policy Engine

**Branch:** `feature/policy-engine`

**Commit:** `feat: add policy engine with MutationObserver enforcement`

**Files created/modified:**
- `src/policy.ts` — expand with runtime enforcement:
  - `createPolicyEnforcer(element: HTMLElement, policy: SanitizePolicy): PolicyEnforcer`
  - Returns `{ destroy(): void }` for cleanup
  - MutationObserver watches `childList`, `attributes`, `characterData`, `subtree`
  - On mutation: check each added/changed node against policy
  - Re-entrancy guard: `let isApplyingFix = false`, disconnect observer during fixes
  - Tag normalization in observer callback (b->strong, i->em)
  - Attribute stripping for disallowed attributes
  - Node removal for disallowed tags
  - maxDepth enforcement on added subtrees

**Tests:** `test/policy.test.ts` —
- Observer catches dynamically added `<script>` tag and removes it
- Observer normalizes `<b>` to `<strong>` on insertion
- Observer strips `onclick` attribute added to an allowed tag
- Re-entrancy guard prevents infinite loops
- `destroy()` disconnects observer cleanly
- maxDepth enforcement on deeply nested insertion
- Allowed tags pass through without modification
- Multiple rapid mutations handled correctly (batch)
- Programmatic innerHTML assignment is caught and sanitized
- Malformed policy object (missing `tags` field) throws helpful error
- Observer callback exception does not crash — catches and continues
- Error event emitted on observer exception

**Verification:** `npm test -- test/policy.test.ts`

**Production failure scenario:** Observer callback throws on malformed DOM node. Mitigation: try/catch in observer callback, log error, continue processing remaining mutations.

---

### Day 5: Paste Handler + contentEditable Core

**Branch:** `feature/editor-core`

**Commit:** `feat: add contentEditable editor core with secure paste handling`

**Files created/modified:**
- `src/editor.ts` — main editor module:
  - `createEditor(element: HTMLElement, options?: EditorOptions): Editor`
  - `EditorOptions: { policy?: SanitizePolicy, onChange?: (html: string) => void }`
  - Sets `contentEditable = 'true'` on element
  - Attaches policy enforcer from `policy.ts`
  - **Paste handler (the critical security path):**
    1. `e.preventDefault()` on paste event
    2. Get `text/html` from clipboard data (fall back to `text/plain`)
    3. Parse via `<template>` element
    4. Run full sanitizer on parsed DOM
    5. Insert sanitized HTML via Selection/Range API (`range.deleteContents()` + `range.insertNode(fragment)`)
    6. Note: does NOT use `execCommand('insertHTML')` — it's inconsistent across browsers (per design doc)
  - `Editor` interface:
    - `exec(command: string, value?: string): void` — execCommand wrapper
    - `getHTML(): string` — returns sanitized innerHTML
    - `getText(): string` — returns textContent
    - `destroy(): void` — cleanup observer, remove event listeners
    - `on(event: string, handler: Function): void` — event system
  - Events: `change`, `paste`, `overflow` (maxLength exceeded)

**Tests:** `test/editor.test.ts` —
- Editor initializes with contentEditable
- Paste event is intercepted and sanitized
- Paste with XSS payload produces clean output
- Paste from clipboard with rich HTML is sanitized
- Paste of plain text works correctly
- `getHTML()` returns current content
- `getText()` returns text only
- `destroy()` cleans up all listeners and observer
- `onChange` callback fires on content changes
- Paste respecting maxLength truncation
- Multiple consecutive pastes work correctly
- createEditor with null element throws helpful error
- createEditor with detached element throws helpful error

**Verification:** `npm test -- test/editor.test.ts`

**Production failure scenario:** Clipboard API denied by browser permissions. Mitigation: fall back to `text/plain` from paste event. If that also fails, the paste is silently dropped (safe default).

---

### Day 6: Formatting Commands

**Branch:** `feature/formatting-commands`

**Commit:** `feat: add text formatting commands via execCommand`

**Files modified:**
- `src/editor.ts` — add formatting command support:
  - `exec('bold')` → `document.execCommand('bold')`
  - `exec('italic')` → `document.execCommand('italic')`
  - `exec('heading', '1'|'2'|'3')` → `document.execCommand('formatBlock', false, '<h1>')`
  - `exec('blockquote')` → `document.execCommand('formatBlock', false, '<blockquote>')`
  - `exec('unorderedList')` → `document.execCommand('insertUnorderedList')`
  - `exec('orderedList')` → `document.execCommand('insertOrderedList')`
  - `exec('link', url)` → `document.execCommand('createLink', false, url)`
  - `exec('unlink')` → `document.execCommand('unlink')`
  - Input validation on `url` parameter: must match allowed protocols from policy
  - `queryState(command): boolean` — checks if format is active at cursor position

**Tests:** `test/editor.test.ts` (extend) —
- Bold wraps selection in `<strong>` (post-normalization)
- Italic wraps selection in `<em>` (post-normalization)
- Heading wraps block in `<h1>`/`<h2>`/`<h3>`
- List creates `<ul><li>` or `<ol><li>`
- Link creates `<a>` with sanitized href
- Link with `javascript:` URL is rejected (does not create link)
- Unlink removes `<a>` wrapper
- Blockquote wraps block
- queryState returns correct state for active formats
- Formatting on empty selection handles gracefully (no crash)
- Formatting with MutationObserver active: command executes and observer normalizes tags
- execCommand returns false (silent failure) — editor emits 'error' event
- exec() with unknown command name — throws helpful error

**Verification:** `npm test -- test/editor.test.ts`

---

### Day 7: Code Blocks

**Branch:** `feature/code-blocks`

**Commit:** `feat: add code block support with pre/code wrapping`

**Files modified:**
- `src/editor.ts` — add code block command:
  - `exec('codeBlock')` — wraps selection/current block in `<pre><code>`
  - Enter key inside `<pre>` inserts `\n` (not new `<div>` or `<p>`)
  - Backspace at start of empty `<pre>` exits code block (converts to `<p>`)
  - `exec('codeBlock')` on existing code block unwraps it (toggle behavior)
  - Does NOT handle Tab key (deferred per design doc)
- `src/defaults.ts` — ensure `pre` and `code` are in DEFAULT_POLICY tags

**Tests:** `test/editor.test.ts` (extend) —
- `exec('codeBlock')` wraps content in `<pre><code>`
- Enter key inside code block inserts newline, not paragraph
- Backspace at start of empty code block exits to paragraph
- Toggle: `exec('codeBlock')` on code block unwraps it
- Code block preserves whitespace
- Paste inside code block strips formatting (plain text only)
- Code block content is sanitized like everything else

**Verification:** `npm test -- test/editor.test.ts`

---

### Day 8: Toolbar

**Branch:** `feature/toolbar`

**Commit:** `feat: add optional toolbar with ARIA roles and keyboard navigation`

**Files created/modified:**
- `src/toolbar.ts` — toolbar module:
  - `createToolbar(editor: Editor, options?: ToolbarOptions): Toolbar`
  - `ToolbarOptions: { actions?: string[], element?: HTMLElement }`
  - Default actions: `['bold', 'italic', 'heading', 'unorderedList', 'orderedList', 'link', 'codeBlock']`
  - Renders `<div role="toolbar">` with `<button>` elements
  - Each button has `aria-label`, `aria-pressed` (for toggle states)
  - Keyboard navigation: arrow keys move focus between buttons, Tab exits toolbar
  - Link button: calls `window.prompt('Enter URL')`, validates, calls `editor.exec('link', url)`
  - Active state tracking: updates `aria-pressed` on selection change
  - Minimal default CSS (inline styles or CSS class hooks, no external stylesheet)
  - `Toolbar.destroy()` — cleanup
- `src/toolbar.css` — default CSS file (external, not inline styles — CSP-safe). Users include it via `<link>` or import.

**Tests:** `test/toolbar.test.ts` —
- Toolbar renders with correct ARIA roles
- Each button has correct aria-label
- Click on bold button calls editor.exec('bold')
- Arrow keys navigate between buttons
- Tab key exits toolbar
- Active format updates aria-pressed
- Link button validates URL against policy protocols
- Link button rejects javascript: URLs
- Custom actions list renders subset of buttons
- destroy() removes toolbar from DOM
- Toolbar with empty actions array renders empty container (no crash)
- Playwright E2E test: full editing session (type, format, paste, undo, getHTML)

**Verification:** `npm test -- test/toolbar.test.ts`

---

### Day 9: Bundle Optimization + Size Audit

**Branch:** `chore/bundle-optimization`

**Commit:** `chore: optimize bundle size and verify sub-5kb budget`

**Work:**
- Review esbuild output, eliminate dead code
- Ensure tree-shaking works: importing only `minisiwyg-editor/sanitize` does not pull in editor code
- Measure each export independently:
  - `minisiwyg-editor/sanitize` gzipped size
  - `minisiwyg-editor/policy` gzipped size
  - `minisiwyg-editor` (core) gzipped size
  - `minisiwyg-editor/toolbar` gzipped size
  - Full bundle (all exports) gzipped size
- CI size check: update to check each export independently
- Create `demo/index.html`:
  - Single self-contained HTML file
  - Inline the built JS (no external script)
  - Shows editor with toolbar
  - Demonstrates paste sanitization
  - Shows size in footer: "This entire editor is X bytes gzipped"
- If over 5kb budget:
  1. First: ensure toolbar is tree-shaken from core
  2. Second: simplify code block keyboard handling
  3. Third: reduce default policy (fewer default tags)

**Tests:** Size check passes. Demo page loads and works.

**Verification:** `npm run build && npm run size-check` and open `demo/index.html` in browser.

**If over budget fallback priority:**
1. Toolbar is already separate export (won't help core size)
2. Remove code block Enter/Backspace handling (just basic pre/code wrapping)
3. Inline the policy interface (remove separate policy.ts, fold into sanitize.ts)
4. Last resort: reduce the default tag whitelist

---

### Day 10: Documentation + Publish

**Branch:** `chore/docs-and-publish`

**Commit:** `docs: add README, API docs, and prepare for npm publish`

**Files created/modified:**
- `README.md`:
  - Size badge (gzipped bytes)
  - One-line description + tagline
  - Quick start (3 lines: install, import, createEditor)
  - Security section (what it protects against, link to test suite)
  - API reference (all exports, all methods)
  - Custom policy example
  - Headless mode (no toolbar) example
  - Browser support
  - License
- `CLAUDE.md` — updated with all build/test/lint commands
- `CHANGELOG.md` — v0.1.0 initial release
- `.github/workflows/ci.yml` — add npm publish on tag push
- `package.json` — verify `files` field, `main`, `module`, `types`, `exports` map

**Tests:** All tests pass. Build succeeds. Size check passes. CI is green.

**Verification:** `npm test && npm run build && npm run size-check && npm pack --dry-run`

---

## NOT in Scope (v1)

- **Mobile support** — contentEditable on mobile (iOS Safari, Android Chrome) is a different beast. Deferred to v2.
- **Plugin system** — extensibility beyond the policy object. Future architecture decision.
- **Framework adapters** — React/Vue/Svelte wrappers. v2 after core stabilizes.
- **Syntax highlighting** — users attach Prism/Highlight.js externally.
- **Custom undo/redo** — browser-native for v1. Custom history stack in v2.
- **Tab indentation in code blocks** — complex contentEditable interaction. Deferred.
- **UMD/IIFE bundle formats** — fast-follow after v1 npm publish.
- **Collaborative editing** — out of scope entirely for now.
- **Image/media embedding** — developer audience needs text + code, not media.
- **Selection/Range API migration** — v2 replacement for execCommand.

## What Already Exists

Empty repository. Nothing to reuse. All code is new.

## Failure Modes

| Codepath | Failure | Test? | Error handling? | User sees? |
|----------|---------|-------|-----------------|------------|
| Paste handler | Clipboard API denied | YES | Falls back to text/plain | Paste works but loses formatting |
| Paste handler | Malformed HTML in clipboard | YES | `<template>` parsing handles gracefully | Clean text inserted |
| MutationObserver | Callback throws on malformed node | YES | try/catch, continue processing | No visible error |
| MutationObserver | Rapid mutations causing jank | YES (batch test) | Batch processing in single callback | Possible brief flicker |
| execCommand | Browser produces unexpected tag | YES | Observer normalizes | Correct formatting |
| execCommand | Command fails silently | YES | Check return value, emit error event | Format doesn't apply |
| Link creation | Invalid URL | YES | Reject, don't create link | No link created |
| Size budget | Build exceeds 5kb | YES (CI) | Build fails, forces optimization | N/A (dev-time) |
| `<template>` | Not available (very old browser) | NO | None — hard requirement | Editor doesn't initialize |

**All critical gaps resolved.** execCommand failure test added to Day 6. Observer exception test added to Day 4.

## Worktree Parallelization Strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| Day 1: Scaffolding | project root, CI | — |
| Day 2-3: Sanitizer | src/sanitize.ts, test/ | Day 1 |
| Day 4: Policy engine | src/policy.ts, test/ | Day 2 (uses sanitizer) |
| Day 5-7: Editor core | src/editor.ts, test/ | Day 4 (uses policy) |
| Day 8: Toolbar | src/toolbar.ts, test/ | Day 5 (uses editor) |
| Day 9: Bundle opt | esbuild config, demo/ | Day 8 (all code exists) |
| Day 10: Docs | README, CLAUDE.md | Day 9 (final sizes known) |

**Sequential implementation, no parallelization opportunity.** Each day depends on the previous day's output. The sanitizer feeds the policy engine, which feeds the editor, which feeds the toolbar. This is an intentional bottom-up build order where each layer is tested before the next one starts.

If you wanted to parallelize: Days 2-3 (sanitizer + tests) could run alongside a separate exploration of the toolbar UI design, but the actual toolbar code depends on the editor API from Day 5. Not worth the merge complexity for a 10-day project.

## Verification

After all 10 days:
1. `npm test` — all tests pass (unit + OWASP security suite)
2. `npm run build` — produces ESM + CJS bundles
3. `npm run size-check` — each export and total under 5kb gzipped
4. Open `demo/index.html` — editor renders, formatting works, paste is sanitized
5. Paste OWASP XSS payloads into demo — nothing executes
6. `npm pack --dry-run` — verify package contents are correct
7. `npx playwright test` — OWASP vectors pass in real browsers

## TODOS (Deferred Work)

### 1. Plugin system architecture
Design and implement a lightweight plugin API. Plugins extend the policy (add new tags/attributes) and register new toolbar actions. The policy engine already accepts a JSON config object, so plugins could be functions that return policy extensions + toolbar actions.
**Depends on:** v1 release, stable Editor interface.

### 2. Selection/Range API migration
Replace execCommand with direct DOM manipulation via Selection/Range APIs. execCommand is deprecated. Browser vendors may reduce reliability. Selection/Range gives full control over output (no b/strong divergence).
**Depends on:** v1 release, real-world execCommand issue data from v1 users.

### 3. Framework adapters (React/Vue/Svelte)
Official wrapper components for major frameworks. Each wrapper is ~20 lines: useEffect to call createEditor, return cleanup from destroy().
**Depends on:** Stable v1 Editor interface.

### 4. MutationObserver security model clarification
The outside voice correctly identified that MutationObserver fires AFTER DOM mutation. An `<img onerror=...>` executes before the observer strips it. Update documentation and marketing to position the paste handler as the primary security boundary and the observer as defense-in-depth.
**Depends on:** Day 10 documentation. Should be resolved before any public launch.

## Completion Summary

- **Step 0: Scope Challenge** — scope accepted as-is (4 modules is minimum for the architecture)
- **Architecture Review:** 3 issues found (build tool, test framework, template parser testing)
- **Code Quality Review:** 1 issue found (circular dependency via types.ts)
- **Test Review:** diagram produced, 7 gaps identified, all filled (25/25 planned coverage)
- **Performance Review:** 1 issue found (large paste performance, deferred)
- **NOT in scope:** written (10 items)
- **What already exists:** written (empty repo)
- **TODOS.md updates:** 4 items proposed to user, all accepted
- **Failure modes:** 0 critical gaps remaining (all resolved)
- **Outside voice:** ran (claude subagent), 10 findings, 6 incorporated
- **Parallelization:** 1 lane, sequential (bottom-up dependency chain)
- **Lake Score:** 7/8 recommendations chose complete option

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

- **OUTSIDE VOICE:** Claude subagent found 10 issues. 6 incorporated (insertHTML fix, security model clarification, esbuild switch, CSP fix, strip default, Playwright primary). 4 acknowledged but deferred (size estimate validation, schedule slack, strategic framing).
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — ready to implement
