# TODOS

## Toolbar

### [A11y] Tab-order skips disabled buttons during view-source mode
**Priority:** P3

While `viewSource` is active, all other toolbar buttons get `disabled = true`, which causes browsers to skip them in sequential Tab order. Keyboard users tab right out of the toolbar instead of landing on the view-source button. Switch to `aria-disabled="true"` plus a click-guard so focus order is preserved.

Files: `src/toolbar.ts` (`toggleSourceMode`).

## Dependencies

### Dev-dependency upgrades available
**Priority:** P3

Majors held back on purpose or not yet evaluated:

- `typescript` 5.9 → 7.0
- `vitest` 3.2 → 4.1
- `happy-dom` 17.6 → 20.11
- `esbuild` 0.25 → 0.28
- `react` / `react-dom` / `@types/react*` 18 → 19. The `peerDependencies` range is already `>=18`, so this is a test-matrix decision, not a consumer-facing one.

In-range patches (`@playwright/test`, `vue`, `@types/react`, `vitest`) can be picked up with `npm update` at any time.

## Completed

### Framework adapters (React/Vue/Svelte)
Official wrapper components shipped as subpath exports (`minisiwyg-editor/react`, `/vue`, `/svelte`). React and Vue are components; Svelte is a `use:minisiwyg` action so no Svelte compiler is required. Adapter HTML goes through `sanitizeToFragment` on mount and on controlled-mode reconcile.
**Completed:** v0.2.0 (2026-04-10)

### Plugin system architecture
Design and implement a lightweight plugin API. Plugins extend the policy (add new tags/attributes/protocols) and register new editor commands + toolbar actions. Exported new public types: `Plugin`, `PluginContext`, `PluginCommand`, `PluginAction`, `PluginPolicyDelta`.
**Completed:** v0.3.0 (2026-04-14)

### MutationObserver security model clarification
README "Security Model" now names the paste handler as the primary boundary and the MutationObserver as defense-in-depth, instead of claiming XSS is architecturally impossible.
**Completed:** v0.3.0 (2026-04-14)

### Selection/Range API migration
Replaced `execCommand` with direct DOM manipulation via the Selection/Range APIs. Removes the deprecated API and the divergent `<b>`/`<strong>` output across browsers.
**Completed:** v0.4.0 (2026-05-13)
