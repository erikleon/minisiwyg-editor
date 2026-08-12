# TODOS

## The size budget shapes this list

The full bundle is 6164 bytes gzipped against the 7168-byte limit that CI enforces — roughly 1000 bytes of headroom, after the budget was raised from 6kb to make room for the plugin hooks.

So each item is tagged with where it has to live:

- **[core]** — cannot be anything else. It wraps every mutation, or it must beat the browser's own contenteditable behavior.
- **[plugin]** — buildable against the `Plugin` interface: policy delta, commands, toolbar actions, and the lifecycle and input hooks added on top of them.

The old **[plugin+api]** tag is gone. Everything it marked is now buildable, since the hooks those items were waiting on exist.

## Blocking

### Ship a real plugin to prove the API [plugin]
**Priority:** P1

The hooks exist and are tested, but nothing in the repo is built on them. Every plugin so far is a test fixture. Until something real is written against the interface, its ergonomics are unproven — the tests confirm the hooks fire, not that they are pleasant to build with.

Horizontal rule is the cheapest proof (policy delta plus an insert command). Markdown input rules are the most informative, since they exercise `onBeforeInput` and are the top-requested feature.

### Undo/redo [core]
**Priority:** P1

v0.4.0 replaced `execCommand` with direct Selection/Range DOM manipulation. Manual DOM mutation does not push onto the browser's native undo stack the way `execCommand` did, so Cmd+Z is inconsistent or dead across the built-in commands. Verify the real browser behavior first (Playwright, not happy-dom), then decide between a bounded history stack and `beforeinput`-driven native undo.

Cost is the problem, though less so than before: the 7kb budget leaves roughly 1000 bytes, which a bounded history stack may now fit inside.

## Toolbar

### [A11y] Tab-order skips disabled buttons during view-source mode
**Priority:** P3 — resolved, kept for reference

Fixed by switching to `aria-disabled` plus a click-guard. See Completed.

## Backlog

### Markdown input rules [plugin]
**Priority:** P2

`# ` → heading, `- ` → list, `` ` `` → inline code, `> ` → blockquote. The Notion-style behavior users now expect. Needs `onBeforeInput`.

### Link editing UI [core-ish]
**Priority:** P2

`src/toolbar.ts` calls `window.prompt('Enter URL')`. It blocks the page, looks dated, and cannot edit or remove an existing link's href. Replace with a small inline popover anchored to the selection. Protocol validation via `isProtocolAllowed` stays exactly as it is.

### Placeholder text [plugin]
**Priority:** P2

Empty-state hint. Cheap in bytes as CSS (`:empty::before`), but needs a `setup` hook to attach and a mount-time class.

### Strikethrough and inline code marks [plugin]
**Priority:** P2

`s`/`del` are not in the default policy and neither has a command. `code` is already allowed by the policy but no command or toolbar button exposes it. Pure policy delta plus commands — a plugin can ship this today with no core change.

### Images [plugin]
**Priority:** P2

Insert-by-URL is a plugin today: add `img` with `src`/`alt` to the policy, register an insert command. Paste and drag-drop upload need `onPaste`.

Security: `img` is the highest-risk tag to allow. `onerror` is already stripped as an event handler and `data:` URLs are a hardcoded denial, but this needs its own XSS vector tests before shipping.

### Horizontal rule [plugin]
**Priority:** P3

`hr` policy delta plus an insert command. Smallest real proof that the plugin API carries its weight.

### Floating bubble toolbar [plugin]
**Priority:** P3

Toolbar that appears on selection. Needs `setup` and a selection-change subscription.

### Word and character count [plugin]
**Priority:** P3

`maxLength` already exists and the editor emits `overflow` when a paste would exceed it, so a live count has something real to hang off. Needs `ctx.on('change')`.

### Paste as plain text [plugin]
**Priority:** P3

Cmd+Shift+V. Needs `onPaste` and `onKeydown`.

### Tables [plugin]
**Priority:** P4

Insert is a plugin. Cell navigation, row/column operations, and Tab-between-cells all need `onKeydown`. Expensive in edge cases; the least certain item here.

### Slash commands and @-mentions [plugin]
**Priority:** P4

The natural showcase for the plugin API once hooks exist.

### i18n for toolbar labels [plugin]
**Priority:** P4

`ACTION_LABELS` in `src/toolbar.ts` is hardcoded English and feeds both `aria-label` and `title`. A `labels` override in `ToolbarOptions` is a few bytes and unblocks non-English use.

## Not planned

**Collaborative editing.** CRDT or OT sync cannot be done inside a 7kb budget, and bolting on a sync engine contradicts the premise of the project. Consumers who need it should drive the editor from their own document model.

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

## Release pipeline

### Publish paths are only exercised during a release
**Priority:** P3

`ci.yml` covers checkout, setup-node, tests and build, so most of the publish job is proven on every PR. What is not: `registry-url`, OIDC trusted publishing, `npm publish --provenance`, and the release-notes extraction. Those run for the first time during an actual release, which is the worst moment to learn something moved.

A dry-run job — `npm publish --dry-run` on a schedule, or against a PR — would cover most of the gap without publishing anything.

## Completed

### Plugin API v2 — lifecycle and input hooks
`Plugin` gained `setup(ctx)` (returning a teardown that `destroy()` runs), `onKeydown`, `onBeforeInput`, and `onPaste`, and `PluginContext` gained `on()` to match its `emit`. Each event hook returns `true` to claim the event, suppressing later plugins and the built-in path.

`onPaste` deliberately runs after sanitization and receives the cleaned fragment, so the paste handler stays the security boundary. The policy is deep-frozen once registration finishes — hooks run on every keystroke, so without that a plugin could widen the policy after the sanitizer and observer already held the object.

Cost 132 bytes (6032 → 6164), which did not fit the 6kb budget. Three trims were tried and none paid: a shared hook dispatcher was byte-neutral and cost argument type-checking, a shared listener table was 3 bytes worse, and dropping the freeze would have saved 24 by giving up a security property. Budget raised to 7kb instead, as v0.3.0 did for the original plugin API.
**Completed:** unreleased (2026-08-12)

### `npm install -g npm@latest` removed from the publish job
The publish job pinned a Node version and then installed whatever `npm@latest` resolved to, and the two drifted apart on npm's schedule rather than ours. It cost one failed release: `npm@latest` became npm@12, which requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, against a job pinned to Node 20 — `EBADENGINE` before it reached `npm publish`.

The install existed because OIDC trusted publishing needs npm >= 11.5.1 and no Node 20 runner bundled that. On Node 24 the bundled npm is 11.12 or newer, so the install is gone. The job now asserts the 11.5.1 floor instead, because `setup-node` resolves to whatever the latest 24.x happens to be and the earliest 24.x shipped npm 11.3.0 — below the floor.
**Completed:** 2026-08-12

### Node 20 dropped
CI, Pages, and publish all run Node 24, and `engines.node` was raised from `>=20` to `>=24`. Node 20 could no longer run the release pipeline at all: `npm@latest` became npm@12, which refuses to install on it. This replaced the earlier plan of a `[20, 24]` CI matrix — with the floor raised to 24 there is no longer a lower version to test.
**Completed:** v0.6.0 (2026-08-12)

### Cmd/Ctrl+B/I/U keyboard shortcuts
`onKeydown` now intercepts the three format shortcuts and routes them through `editor.exec`. Before this, nothing handled them, so the browser's own contenteditable handling inserted `<b>`/`<i>` — tags the default policy does not allow — and the observer stripped them straight back out, making the shortcuts look dead.
**Completed:** v0.5.0 (2026-08-11)

### [A11y] Toolbar tab order during view-source mode
Buttons are soft-disabled with `aria-disabled="true"` instead of the `disabled` property, so they keep their place in sequential focus order and keyboard users can still reach the view-source button to leave the mode. `onButtonClick` rejects their commands while the mode is active.
**Completed:** v0.5.0 (2026-08-11)

### Release fails when changelog notes are missing
The publish workflow reads release notes from the CHANGELOG.md section matching the version. An `## [Unreleased]` heading does not match, and `gh release create --notes-file -` accepts empty input without complaint, so a forgotten rename would publish to npm and cut a release with no notes. Both `create-tag` and the publish job now check for notes ahead of `npm publish`, so a mistake leaves no tag and no package.
**Completed:** v0.5.0 (2026-08-11)

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
