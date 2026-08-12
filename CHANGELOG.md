# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plugin lifecycle and input hooks. A plugin can now define `setup(ctx)` (returning an optional teardown that `destroy()` runs), `onKeydown`, `onBeforeInput`, and `onPaste`. Each event hook returns `true` to claim the event, which suppresses both later plugins and the editor's built-in handling. This unblocks the features the previous plugin API could not express — markdown input rules, placeholder, bubble toolbar, paste-as-plain-text, and mentions.
- `PluginContext.on(event, handler)` so a plugin can subscribe to `change`, matching the `emit` it already had.
- New exported type `PluginTeardown`.

### Changed
- Total gzipped budget raised from 6kb to 7kb (full bundle now 6164 bytes; 7kb hard limit enforced in CI) to make room for the hooks without dropping the policy freeze. Marketing claim updated from "sub-6kb" to "sub-7kb" across README, demo, and package description.

### Security
- The sanitizer policy is deep-frozen once plugin registration finishes — tag map, per-tag attribute arrays, and protocol list. Plugin hooks run on every keystroke and paste, so without this a hook could widen the policy at runtime, after the sanitizer and MutationObserver had already been handed the object. Registration stays the only point where the policy can grow.
- `onPaste` runs after sanitization and receives the cleaned `DocumentFragment`, never the raw clipboard HTML. A plugin can reshape or claim the insertion but cannot reintroduce stripped content.

## [v0.6.0] - 2026-08-12

### Changed
- **Breaking:** `engines.node` raised from `>=20` to `>=24`. Installing on Node 20 now produces an `EBADENGINE` warning. Node 20 reached the end of its support window, and the release pipeline can no longer run on it — `npm@latest` is now npm@12, which refuses to install on Node 20 at all.
- CI and Pages workflows moved from Node 20 to Node 24, matching the version the package is built and published on.

## [v0.5.0] - 2026-08-11

### Added
- Cmd/Ctrl+B, Cmd/Ctrl+I, and Cmd/Ctrl+U now apply bold, italic, and underline through `editor.exec`. Any other modifier combination, including Alt, is left to the browser.

### Fixed
- The three format shortcuts previously appeared to do nothing. Nothing in the editor handled them, so the browser's own contentEditable handling inserted `<b>`/`<i>` — tags the default policy does not allow — and the MutationObserver removed them again. The editor now calls `preventDefault` and produces `<strong>`/`<em>`/`<u>` to match the toolbar.
- Toolbar buttons are now soft-disabled with `aria-disabled="true"` instead of the `disabled` property while view-source mode is active. A disabled button is skipped by sequential focus, so keyboard users tabbed straight out of the toolbar and could not reach the view-source button to leave the mode. The buttons stay focusable, and the click handler rejects their commands while the mode is on.

## [v0.4.0] - 2026-05-13

### Changed
- All formatting commands (`bold`, `italic`, `underline`, `heading`, `blockquote`, `unorderedList`, `orderedList`, `link`, `unlink`) now use the Selection/Range API instead of the deprecated `document.execCommand`. This eliminates divergent `<b>`/`<strong>` output across browsers, gives full control over the produced markup, and future-proofs the editor against browser vendors removing `execCommand` support.

### Removed
- All internal calls to `document.execCommand`. The API was deprecated in 2016 and its removal is no longer hypothetical in non-standard browsing environments.

## [v0.3.0] - 2026-04-14

### Added
- Plugin API. Pass `plugins: [...]` to `createEditor` and `createToolbar` to extend minisiwyg without forking. A plugin can (a) add allowed tags/attributes/protocols to the sanitizer policy, (b) register new editor commands with `exec` and optional `queryState`, and (c) register toolbar actions with a label and icon. Plugin commands receive a `PluginContext` with the editor element, document, merged policy, and an `emit` hook that routes `change` back through the normal change pipeline.
- New public types: `Plugin`, `PluginContext`, `PluginCommand`, `PluginAction`, `PluginPolicyDelta`, exported from the main entry.

### Changed
- Total gzipped budget raised from 5kb to 6kb (full bundle now 5380 bytes; 6kb hard limit enforced in CI) to make room for the plugin API without dropping features. Marketing claim updated from "sub-5kb" to "sub-6kb" across README, demo, and package description.

### Security
- Plugin policy deltas are merged additively into the sanitizer policy before the MutationObserver and paste handler see it, so plugin-added tags go through the same whitelist enforcement as built-in tags. `javascript:` and `data:` URLs remain hardcoded denials regardless of plugin input. Plugin tag keys must be lowercase (throws at registration) to prevent case-mismatch bypasses. Duplicate command names (across plugins or against built-ins) throw at registration.

## [v0.2.2] - 2026-04-13

### Added
- Underline toolbar action with matching `editor.exec('underline')` command and `queryState('underline')` support. The default sanitization policy now allows `<u>` so underlined runs survive paste and round-tripping.
- View Source toolbar button that toggles a read-only `<pre>` showing the editor's current HTML. While active, the editor element is hidden and other toolbar buttons are disabled. Toggling off restores the editor and any consumer-set inline `display` value.
- `Editor.element` is now exposed on the public Editor interface, giving consumers and the toolbar direct access to the contentEditable host element.

## [v0.2.1] - 2026-04-12

### Fixed
- Heading and blockquote toolbar buttons now toggle off when clicked while already active, reverting the block to a plain paragraph instead of wrapping it again.

## [v0.2.0] - 2026-04-10

### Added
- Framework adapters for React, Vue 3, and Svelte, shipped as subpath exports (`minisiwyg-editor/react`, `/vue`, `/svelte`). Adapters are thin wrappers around `createEditor` with both uncontrolled (`initialHTML`) and opt-in controlled (`value`) binding modes. React and Vue adapters are components; Svelte adapter is a `use:minisiwyg` action (no Svelte compiler required).
- React/Vue/Svelte listed as optional peer dependencies so consumers install only what they use.

### Security
- Adapter mount and controlled-mode reconcile paths now route initial and updated HTML through `sanitizeToFragment` before landing in the live DOM, closing an XSS path where `<img onerror>` payloads in `initialHTML` or `value` could fire before the MutationObserver reacted.

### Fixed
- React and Svelte adapters track the latest `onChange` callback via a ref/closure variable, eliminating a stale-closure bug where a new callback passed on re-render was ignored in favor of the mount-time one.

## [v0.1.1] - 2026-04-09

### Added
- Toolbar buttons now render compact SVG icons instead of text labels, with `aria-label` and `title` preserved for accessibility.
- Visual separators between toolbar groups (inline marks, block format, lists, inserts) via a `'|'` entry in the `actions` array.

### Fixed
- Toggling off a bulleted or numbered list no longer drops list content. The editor now manually unwraps `<li>` elements into `<p>` paragraphs instead of relying on `execCommand`, which left behind `<div>` wrappers that the policy enforcer stripped.
- All editor mutation paths (paste, code block toggle, list unwrap, code-block Enter/Backspace) now consistently fire both `editor.on('change')` and the `options.onChange` callback. Previously several paths notified only one of the two.

## [v0.1.0] - 2026-04-09

Initial release.

### Added
- Whitelist-based HTML sanitizer (`minisiwyg-editor/sanitize`) with `<template>` parsing, depth-first DOM tree walking, attribute filtering, and protocol validation.
- Hardcoded denial of `javascript:` and `data:` URLs, regardless of policy configuration.
- Protocol bypass protection: HTML entity decoding, URL decoding, whitespace and case normalization.
- Tag normalization (`<b>` → `<strong>`, `<i>` → `<em>`).
- Declarative `SanitizePolicy` interface with `tags`, `strip`, `maxDepth`, `maxLength`, and `protocols` fields. Deeply frozen `DEFAULT_POLICY`.
- Policy engine (`minisiwyg-editor/policy`) with MutationObserver-based runtime enforcement, re-entrancy guard, and observer-exception recovery.
- contentEditable editor core (`minisiwyg-editor`) with secure paste handling via Selection/Range API (no `insertHTML`).
- Formatting commands: `bold`, `italic`, `heading`, `blockquote`, `unorderedList`, `orderedList`, `link`, `unlink`, `codeBlock`. `queryState` for active-format detection.
- Code block support with Enter inserting `\n` and Backspace exiting empty blocks.
- Optional toolbar (`minisiwyg-editor/toolbar`) with ARIA roles, keyboard navigation, and `aria-pressed` state tracking.
- OWASP XSS cheat sheet test suite running in both happy-dom and Playwright (Chromium + Firefox).
- ESM and CJS builds with subpath exports and TypeScript declarations.
- Size budget enforced in CI: total bundle under 5kb gzipped.
- Self-contained demo page generated by `npm run build:demo`.

[v0.6.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.6.0
[v0.5.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.5.0
[v0.4.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.4.0
[v0.3.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.3.0
[v0.2.2]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.2.2
[v0.2.1]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.2.1
[v0.2.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.2.0
[v0.1.1]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.1.1
[v0.1.0]: https://github.com/erikleon/minisiwyg-editor/releases/tag/v0.1.0
