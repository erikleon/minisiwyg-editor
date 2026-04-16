# TODOS

## Toolbar

### [A11y] Tab-order skips disabled buttons during view-source mode
**Priority:** P3

While `viewSource` is active, all other toolbar buttons get `disabled = true`, which causes browsers to skip them in sequential Tab order. Keyboard users tab right out of the toolbar instead of landing on the view-source button. Switch to `aria-disabled="true"` plus a click-guard so focus order is preserved.

Files: `src/toolbar.ts` (`toggleSourceMode`).

## v2 — Post-v1 Release

### 2. Selection/Range API migration
Replace execCommand with direct DOM manipulation via Selection/Range APIs. execCommand is deprecated. Browser vendors may reduce reliability. Selection/Range gives full control over output (no b/strong divergence).
**Depends on:** v1 release, real-world execCommand issue data from v1 users.

### 3. Framework adapters (React/Vue/Svelte)
Official wrapper components for major frameworks. Each wrapper is ~20 lines: useEffect to call createEditor, return cleanup from destroy().
**Depends on:** Stable v1 Editor interface.

### 4. MutationObserver security model clarification
MutationObserver fires AFTER DOM mutation. An `<img onerror=...>` executes before the observer strips it. Update documentation and marketing to position the paste handler as the primary security boundary and the observer as defense-in-depth. Say "XSS prevented at every entry point" not "architecturally impossible."
**Depends on:** Day 10 documentation. Should be resolved before any public launch.

## Completed

### Plugin system architecture
Design and implement a lightweight plugin API. Plugins extend the policy (add new tags/attributes/protocols) and register new editor commands + toolbar actions. Exported new public types: `Plugin`, `PluginContext`, `PluginCommand`, `PluginAction`, `PluginPolicyDelta`.
**Completed:** v0.3.0 (2026-04-14)
