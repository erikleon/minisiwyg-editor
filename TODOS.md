# TODOS

## The size budget shapes this list

The full bundle is 6032 bytes gzipped against the 6144-byte limit that CI enforces. About 110 bytes of headroom. Nothing below fits in core without either raising the budget or moving something out.

So each item is tagged with where it has to live:

- **[core]** — cannot be anything else. It wraps every mutation, or it must beat the browser's own contenteditable behavior.
- **[plugin]** — buildable today against the v0.3.0 `Plugin` interface: policy delta, commands, toolbar actions.
- **[plugin+api]** — a plugin in shape, but blocked on the plugin API gaining hooks. See "Plugin API v2" below.

## Blocking

### Plugin API v2 — lifecycle and input hooks
**Priority:** P1
**Blocks:** every [plugin+api] item below

`Plugin` today is `{ name, policy, commands, actions }`. A plugin can add tags, register commands, and add buttons. It cannot see a keystroke, a paste, a selection change, or the editor's mount and teardown. That rules out the whole category of features people actually ask for — input rules, placeholder, bubble toolbar, mentions.

Proposed additions:

- `setup(ctx)` returning an optional teardown function, called at `createEditor` time and unwound by `destroy()`.
- `onKeydown(ctx, event)` and `onBeforeInput(ctx, event)`, returning `true` to signal handled and suppress the built-in path.
- `onPaste(ctx, event, fragment)` running after sanitization, never before. The paste handler stays the security boundary; a plugin gets the already-clean fragment.
- `ctx.on(event, handler)` so a plugin can subscribe to `change`, matching the `emit` it already has.

Security note: hooks must not be able to widen the policy at runtime. Policy deltas stay merged once, at registration.

Files: `src/types.ts`, `src/editor.ts`.

### Undo/redo [core]
**Priority:** P1

v0.4.0 replaced `execCommand` with direct Selection/Range DOM manipulation. Manual DOM mutation does not push onto the browser's native undo stack the way `execCommand` did, so Cmd+Z is inconsistent or dead across the built-in commands. Verify the real browser behavior first (Playwright, not happy-dom), then decide between a bounded history stack and `beforeinput`-driven native undo.

Cost is the problem: a history stack is not a 110-byte feature. This likely forces the budget conversation.

## Toolbar

### [A11y] Tab-order skips disabled buttons during view-source mode
**Priority:** P3 — resolved, kept for reference

Fixed by switching to `aria-disabled` plus a click-guard. See Completed.

## Backlog

### Markdown input rules [plugin+api]
**Priority:** P2

`# ` → heading, `- ` → list, `` ` `` → inline code, `> ` → blockquote. The Notion-style behavior users now expect. Needs `onBeforeInput`.

### Link editing UI [core-ish]
**Priority:** P2

`src/toolbar.ts` calls `window.prompt('Enter URL')`. It blocks the page, looks dated, and cannot edit or remove an existing link's href. Replace with a small inline popover anchored to the selection. Protocol validation via `isProtocolAllowed` stays exactly as it is.

### Placeholder text [plugin+api]
**Priority:** P2

Empty-state hint. Cheap in bytes as CSS (`:empty::before`), but needs a `setup` hook to attach and a mount-time class.

### Strikethrough and inline code marks [plugin]
**Priority:** P2

`s`/`del` are not in the default policy and neither has a command. `code` is already allowed by the policy but no command or toolbar button exposes it. Pure policy delta plus commands — a plugin can ship this today with no core change.

### Images [plugin, partly plugin+api]
**Priority:** P2

Insert-by-URL is a plugin today: add `img` with `src`/`alt` to the policy, register an insert command. Paste and drag-drop upload need `onPaste`.

Security: `img` is the highest-risk tag to allow. `onerror` is already stripped as an event handler and `data:` URLs are a hardcoded denial, but this needs its own XSS vector tests before shipping.

### Horizontal rule [plugin]
**Priority:** P3

`hr` policy delta plus an insert command. Smallest real proof that the plugin API carries its weight.

### Floating bubble toolbar [plugin+api]
**Priority:** P3

Toolbar that appears on selection. Needs `setup` and a selection-change subscription.

### Word and character count [plugin+api]
**Priority:** P3

`maxLength` already exists and the editor emits `overflow` when a paste would exceed it, so a live count has something real to hang off. Needs `ctx.on('change')`.

### Paste as plain text [plugin+api]
**Priority:** P3

Cmd+Shift+V. Needs `onPaste` and `onKeydown`.

### Tables [plugin+api]
**Priority:** P4

Insert is a plugin. Cell navigation, row/column operations, and Tab-between-cells all need `onKeydown`. Expensive in edge cases; the least certain item here.

### Slash commands and @-mentions [plugin+api]
**Priority:** P4

The natural showcase for the plugin API once hooks exist.

### i18n for toolbar labels [plugin]
**Priority:** P4

`ACTION_LABELS` in `src/toolbar.ts` is hardcoded English and feeds both `aria-label` and `title`. A `labels` override in `ToolbarOptions` is a few bytes and unblocks non-English use.

## Not planned

**Collaborative editing.** CRDT or OT sync cannot be done inside a 6kb budget, and bolting on a sync engine contradicts the premise of the project. Consumers who need it should drive the editor from their own document model.

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

Also: the CI workflows pin `node-version: 20`, and GitHub now warns that Node 20 actions are forced onto Node 24. Bump the workflows and the `engines.node` floor together.

## Completed

### Cmd/Ctrl+B/I/U keyboard shortcuts
`onKeydown` now intercepts the three format shortcuts and routes them through `editor.exec`. Before this, nothing handled them, so the browser's own contenteditable handling inserted `<b>`/`<i>` — tags the default policy does not allow — and the observer stripped them straight back out, making the shortcuts look dead.
**Completed:** unreleased (2026-08-11)

### [A11y] Toolbar tab order during view-source mode
Buttons are soft-disabled with `aria-disabled="true"` instead of the `disabled` property, so they keep their place in sequential focus order and keyboard users can still reach the view-source button to leave the mode. `onButtonClick` rejects their commands while the mode is active.
**Completed:** unreleased (2026-08-11)

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
