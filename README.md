# minisiwyg-editor

A sub-5kb gzipped, zero-dependency WYSIWYG editor with built-in XSS protection.

Spiritual successor to [Pell](https://github.com/jaredreich/pell) (~1.2kb, 12k stars, abandoned with known XSS vulnerabilities). minisiwyg-editor treats security as architecture, not an afterthought. The sanitizer is built into the editor via a declarative policy engine, not bolted on as a dependency.

## Live Demo

Try it in your browser: **[erikleon.github.io/minisiwyg-editor](https://erikleon.github.io/minisiwyg-editor/)**

The demo runs the full editor + toolbar in ~3.5kb gzipped. Paste an XSS payload (`<img src=x onerror=alert(1)>`) and watch the sanitizer strip it in real time.

## Features

- **Tiny.** ~3.5kb gzipped total. 5kb hard limit enforced in CI.
- **Zero runtime dependencies.** Nothing to audit, nothing to break.
- **XSS protection at every entry point.** Whitelist-based HTML sanitizer blocks `javascript:`, `data:`, event handlers, and encoded bypass attempts. Tested against OWASP XSS cheat sheet vectors.
- **Declarative policy.** JSON-serializable rules define allowed tags, attributes, protocols, depth, and length. Store policies in a database, transmit them over the wire, validate them with a schema.
- **Tree-shakeable exports.** Import only what you need. The sanitizer works standalone without the editor.
- **TypeScript-first.** Full type definitions shipped with the package.
- **CSP-safe.** No inline styles, no `eval`, no `Function` constructor.

## Quick Start

```bash
npm install minisiwyg-editor
```

```typescript
import { createEditor } from 'minisiwyg-editor';
import { createToolbar } from 'minisiwyg-editor/toolbar';

const editor = createEditor(document.querySelector('#editor')!, {
  onChange: (html) => console.log(html),
});

const toolbar = createToolbar(editor);
document.querySelector('#toolbar')!.appendChild(toolbar.element);
```

Or use the sanitizer standalone, with no editor:

```typescript
import { sanitize, DEFAULT_POLICY } from 'minisiwyg-editor/sanitize';

const dirty = '<p onclick="alert(1)">Hello <script>steal(cookies)</script><strong>world</strong></p>';
const clean = sanitize(dirty, DEFAULT_POLICY);
// → '<p>Hello <strong>world</strong></p>'
```

## Subpath Exports

minisiwyg-editor ships four independent modules. Each can be imported separately, and unused modules are tree-shaken out of your bundle.

| Export | Size (gzip) | Description |
|---|---|---|
| `minisiwyg-editor/sanitize` | ~1.6kb | Standalone HTML sanitizer. No DOM dependencies beyond `<template>`. |
| `minisiwyg-editor/policy` | ~0.3kb | MutationObserver-based runtime enforcement. Defense-in-depth. |
| `minisiwyg-editor` | ~1.6kb | contentEditable core with paste handler and formatting commands. |
| `minisiwyg-editor/toolbar` | ~0.1kb | Optional toolbar UI with ARIA roles and keyboard navigation. |

```typescript
// Use just the sanitizer
import { sanitize, DEFAULT_POLICY } from 'minisiwyg-editor/sanitize';

// Use the full editor
import { createEditor } from 'minisiwyg-editor';

// Add the optional toolbar
import { createToolbar } from 'minisiwyg-editor/toolbar';
```

## Sanitizer

The sanitizer is the security core. It parses HTML via a `<template>` element (no script execution), walks the DOM tree depth-first, and removes anything not in the whitelist.

### How It Works

1. HTML is parsed into a DOM tree using `<template>` (safe, no scripts execute)
2. The tree is walked depth-first, checking each node against the policy
3. Disallowed tags are removed (strip mode) or unwrapped to plain text (unwrap mode)
4. Disallowed attributes are stripped. Event handlers (`on*`) are always stripped.
5. URL attributes (`href`, `src`, `action`) are validated against allowed protocols
6. `javascript:` and `data:` URLs are hardcoded denials, they cannot be allowed via policy
7. Tags are normalized: `<b>` becomes `<strong>`, `<i>` becomes `<em>`
8. Depth and length limits are enforced

### Protocol Bypass Protection

The sanitizer decodes HTML entities (`&#x6A;` to `j`), URL encoding (`%6A` to `j`), strips whitespace and control characters, and normalizes case before checking protocols. This blocks common XSS bypass techniques:

```typescript
// All of these are blocked:
sanitize('<a href="javascript:alert(1)">',           DEFAULT_POLICY); // direct
sanitize('<a href="JaVaScRiPt:alert(1)">',           DEFAULT_POLICY); // mixed case
sanitize('<a href="&#x6A;avascript:alert(1)">',      DEFAULT_POLICY); // HTML entities
sanitize('<a href="%6Aavascript:alert(1)">',          DEFAULT_POLICY); // URL encoding
sanitize('<a href=" java\tscript:alert(1)">',         DEFAULT_POLICY); // whitespace
```

## Policy

A `SanitizePolicy` is a plain object that controls what HTML is allowed. It is JSON-serializable.

```typescript
interface SanitizePolicy {
  tags: Record<string, string[]>;  // Allowed tags → allowed attributes
  strip: boolean;                   // true: remove disallowed nodes. false: unwrap (keep text)
  maxDepth: number;                 // Maximum nesting depth
  maxLength: number;                // Maximum text content length
  protocols: string[];              // Allowed URL protocols (javascript/data always denied)
}
```

### DEFAULT_POLICY

The built-in default policy allows common formatting tags with sensible limits:

```typescript
{
  tags: {
    p: [], br: [], strong: [], em: [],
    a: ['href', 'title', 'target'],
    h1: [], h2: [], h3: [],
    ul: [], ol: [], li: [],
    blockquote: [], pre: [], code: [],
  },
  strip: true,
  maxDepth: 10,
  maxLength: 100_000,
  protocols: ['https', 'http', 'mailto'],
}
```

`DEFAULT_POLICY` is deeply frozen at runtime. It cannot be mutated.

### Custom Policies

```typescript
import { sanitize } from 'minisiwyg-editor/sanitize';
import type { SanitizePolicy } from 'minisiwyg-editor/sanitize';

// Minimal: only bold and italic, no links
const strict: SanitizePolicy = {
  tags: { strong: [], em: [] },
  strip: false,           // unwrap disallowed tags (keep text content)
  maxDepth: 5,
  maxLength: 10_000,
  protocols: [],           // no URL attributes allowed anyway
};

sanitize('<div><a href="https://example.com">Click <b>here</b></a></div>', strict);
// → 'Click <strong>here</strong>'
```

```typescript
// Permissive: allow images
const permissive: SanitizePolicy = {
  tags: {
    ...DEFAULT_POLICY.tags,
    img: ['src', 'alt', 'width', 'height'],
  },
  strip: true,
  maxDepth: 15,
  maxLength: 500_000,
  protocols: ['https', 'http', 'mailto'],
};
```

## Editor API

```typescript
import { createEditor } from 'minisiwyg-editor';

const editor = createEditor(element, {
  policy: DEFAULT_POLICY,         // optional, defaults to DEFAULT_POLICY
  onChange: (html) => save(html), // optional change callback
});
```

The returned `Editor` exposes:

| Method | Description |
|---|---|
| `exec(command, value?)` | Run a formatting command. See commands below. |
| `queryState(command)` | Returns `true` if the format is active at the cursor. |
| `getHTML()` | Returns the current sanitized HTML. |
| `getText()` | Returns the current text content. |
| `on(event, handler)` | Subscribe to `change`, `paste`, `overflow`, or `error` events. |
| `destroy()` | Disconnect the observer and remove all listeners. |

Supported commands: `bold`, `italic`, `heading` (with value `'1'`, `'2'`, or `'3'`), `blockquote`, `unorderedList`, `orderedList`, `link` (with URL value), `unlink`, `codeBlock`.

## Toolbar

```typescript
import { createToolbar } from 'minisiwyg-editor/toolbar';

const toolbar = createToolbar(editor, {
  // Optional. Defaults to all built-in actions in this order:
  actions: ['bold', 'italic', 'heading', 'unorderedList', 'orderedList', 'link', 'codeBlock'],
});

document.body.appendChild(toolbar.element);
```

The toolbar renders a `<div role="toolbar">` containing `<button>` elements with `aria-label` and `aria-pressed` attributes. Arrow keys move focus between buttons; Tab exits the toolbar. The link button uses `window.prompt()` to collect a URL and validates it against the active policy's protocols. Call `toolbar.destroy()` to remove it.

## Security Model

The editor has two layers of XSS protection:

1. **Paste handler (primary boundary).** When the user pastes content, it is intercepted, parsed via `<template>`, sanitized through the policy, and inserted using the Selection/Range API. Dangerous content never enters the DOM.

2. **MutationObserver (defense-in-depth).** A MutationObserver watches the contentEditable element for DOM mutations and removes anything that violates the policy. This catches edge cases where content enters through browser behavior (drag-and-drop, spell-check replacements, browser extensions).

The sanitizer itself is tested against OWASP XSS cheat sheet vectors in both happy-dom (fast unit tests) and Playwright (real browser tests).

### What Is Always Blocked

- `<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, `<form>` tags
- All event handler attributes (`onclick`, `onerror`, `onload`, etc.)
- `javascript:` and `data:` URLs, regardless of policy configuration
- HTML entity, URL encoding, and mixed-case bypass attempts
- HTML comments and processing instructions
- Content beyond the configured depth and length limits

## Browser Support

minisiwyg-editor requires browsers that support `<template>`, `MutationObserver`, and `contentEditable`. This covers all modern browsers:

- Chrome 26+
- Firefox 22+
- Safari 8+
- Edge 13+

## Development

```bash
npm install              # install dev dependencies
npm run build            # esbuild: ESM + CJS output + type declarations
npm test                 # vitest with happy-dom
npx playwright test      # OWASP XSS vectors in real browsers
npm run size-check       # fails if total gzipped > 5kb
npm run typecheck        # TypeScript type checking
```

Run a single test file:

```bash
npx vitest run test/sanitize.test.ts
```

## Architecture

```
src/
  types.ts      Shared TypeScript interfaces (SanitizePolicy, Editor, Toolbar)
  defaults.ts   DEFAULT_POLICY (deep-frozen)
  sanitize.ts   DOM tree walker, whitelist engine, protocol validation
  policy.ts     MutationObserver wrapper, re-entrancy guard
  editor.ts     contentEditable core, paste handler, execCommand
  toolbar.ts    Optional ARIA toolbar UI
  index.ts      Re-exports for main entry point
```

Bottom-up dependency chain: sanitize < policy < editor < toolbar. Each layer is tested independently before the next one builds on it.

## License

MIT
