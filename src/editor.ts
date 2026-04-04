import type { SanitizePolicy, EditorOptions, Editor } from './types';
import { DEFAULT_POLICY } from './defaults';
import { sanitizeToFragment } from './sanitize';
import { createPolicyEnforcer, type PolicyEnforcer } from './policy';
import { isProtocolAllowed } from './shared';

export type { Editor, EditorOptions } from './types';
export { DEFAULT_POLICY } from './defaults';

type EditorEvent = 'change' | 'paste' | 'overflow' | 'error';
type EventHandler = (...args: unknown[]) => void;

const SUPPORTED_COMMANDS = new Set([
  'bold',
  'italic',
  'heading',
  'blockquote',
  'unorderedList',
  'orderedList',
  'link',
  'unlink',
  'codeBlock',
]);

/**
 * Create a contentEditable-based editor with built-in sanitization.
 *
 * The paste handler is the primary security boundary — it sanitizes HTML
 * before insertion via Selection/Range API. The MutationObserver-based
 * policy enforcer provides defense-in-depth.
 */
export function createEditor(
  element: HTMLElement,
  options?: EditorOptions,
): Editor {
  if (!element) {
    throw new TypeError('createEditor requires an HTMLElement');
  }
  if (!element.ownerDocument || !element.parentNode) {
    throw new TypeError('createEditor requires an element attached to the DOM');
  }

  const src = options?.policy ?? DEFAULT_POLICY;
  const policy: SanitizePolicy = {
    tags: Object.fromEntries(
      Object.entries(src.tags).map(([k, v]) => [k, [...v]]),
    ),
    strip: src.strip,
    maxDepth: src.maxDepth,
    maxLength: src.maxLength,
    protocols: [...src.protocols],
  };

  const handlers: Record<string, EventHandler[]> = {};
  const doc = element.ownerDocument;

  function emit(event: EditorEvent, ...args: unknown[]): void {
    for (const handler of handlers[event] ?? []) {
      handler(...args);
    }
  }

  // Set up contentEditable
  element.contentEditable = 'true';

  // Attach policy enforcer (MutationObserver defense-in-depth)
  const enforcer: PolicyEnforcer = createPolicyEnforcer(element, policy);
  enforcer.on('error', (err) => emit('error', err));

  // Paste handler — the primary security boundary
  function onPaste(e: ClipboardEvent): void {
    e.preventDefault();

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // Prefer HTML, fall back to plain text
    let html = clipboard.getData('text/html');
    if (!html) {
      const text = clipboard.getData('text/plain');
      if (!text) return;
      // Escape plain text and convert newlines to <br>
      html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>');
    }

    // Sanitize through policy — returns DocumentFragment directly
    // to avoid the serialize→reparse mXSS vector
    const fragment = sanitizeToFragment(html, policy);

    // Insert via Selection/Range API (NOT execCommand('insertHTML'))
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    // Check overflow using text content length
    if (policy.maxLength > 0) {
      const pasteTextLen = fragment.textContent?.length ?? 0;
      const currentLen = element.textContent?.length ?? 0;
      if (currentLen + pasteTextLen > policy.maxLength) {
        emit('overflow', policy.maxLength);
      }
    }

    // Remember last inserted node for cursor positioning
    let lastNode: Node | null = fragment.lastChild;
    range.insertNode(fragment);

    // Move cursor after inserted content
    if (lastNode) {
      const newRange = doc.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    emit('paste', element.innerHTML);
    emit('change', element.innerHTML);
  }

  // Input handler for change events
  function onInput(): void {
    emit('change', element.innerHTML);
    options?.onChange?.(element.innerHTML);
  }

  element.addEventListener('paste', onPaste);
  element.addEventListener('input', onInput);

  function hasAncestor(node: Node, tagName: string): boolean {
    let current: Node | null = node;
    while (current && current !== element) {
      if (current.nodeType === 1 && (current as Element).tagName === tagName) return true;
      current = current.parentNode;
    }
    return false;
  }

  const editor: Editor = {
    exec(command: string, value?: string): void {
      if (!SUPPORTED_COMMANDS.has(command)) {
        throw new Error(`Unknown editor command: "${command}"`);
      }

      element.focus();

      switch (command) {
        case 'bold':
          doc.execCommand('bold', false);
          break;
        case 'italic':
          doc.execCommand('italic', false);
          break;
        case 'heading': {
          const level = value ?? '1';
          if (!['1', '2', '3'].includes(level)) {
            throw new Error(`Invalid heading level: "${level}". Use 1, 2, or 3`);
          }
          doc.execCommand('formatBlock', false, `<h${level}>`);
          break;
        }
        case 'blockquote':
          doc.execCommand('formatBlock', false, '<blockquote>');
          break;
        case 'unorderedList':
          doc.execCommand('insertUnorderedList', false);
          break;
        case 'orderedList':
          doc.execCommand('insertOrderedList', false);
          break;
        case 'link': {
          if (!value) {
            throw new Error('Link command requires a URL value');
          }
          const trimmed = value.trim();
          if (!isProtocolAllowed(trimmed, policy.protocols)) {
            emit('error', new Error(`Protocol not allowed: ${trimmed}`));
            return;
          }
          doc.execCommand('createLink', false, trimmed);
          break;
        }
        case 'unlink':
          doc.execCommand('unlink', false);
          break;
        case 'codeBlock':
          doc.execCommand('formatBlock', false, '<pre>');
          break;
      }
    },

    queryState(command: string): boolean {
      if (!SUPPORTED_COMMANDS.has(command)) {
        throw new Error(`Unknown editor command: "${command}"`);
      }

      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return false;

      const node = sel.anchorNode;
      if (!node || !element.contains(node)) return false;

      switch (command) {
        case 'bold':
          return hasAncestor(node, 'STRONG') || hasAncestor(node, 'B');
        case 'italic':
          return hasAncestor(node, 'EM') || hasAncestor(node, 'I');
        case 'heading':
          return hasAncestor(node, 'H1') || hasAncestor(node, 'H2') || hasAncestor(node, 'H3');
        case 'blockquote':
          return hasAncestor(node, 'BLOCKQUOTE');
        case 'unorderedList':
          return hasAncestor(node, 'UL');
        case 'orderedList':
          return hasAncestor(node, 'OL');
        case 'link':
          return hasAncestor(node, 'A');
        case 'unlink':
          return false;
        case 'codeBlock':
          return hasAncestor(node, 'PRE');
        default:
          return false;
      }
    },

    getHTML(): string {
      return element.innerHTML;
    },

    getText(): string {
      return element.textContent ?? '';
    },

    destroy(): void {
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('input', onInput);
      enforcer.destroy();
      element.contentEditable = 'false';
    },

    on(event: string, handler: EventHandler): void {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
  };

  return editor;
}
