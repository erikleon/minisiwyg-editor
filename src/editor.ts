import type { SanitizePolicy, EditorOptions, Editor } from './types';
import { DEFAULT_POLICY } from './defaults';
import { sanitize } from './sanitize';
import { createPolicyEnforcer, type PolicyEnforcer } from './policy';

export type { Editor, EditorOptions } from './types';
export { DEFAULT_POLICY } from './defaults';

type EditorEvent = 'change' | 'paste' | 'overflow' | 'error';
type EventHandler = (...args: unknown[]) => void;

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

  const policy: SanitizePolicy = options?.policy
    ? { ...options.policy }
    : {
        tags: { ...DEFAULT_POLICY.tags },
        strip: DEFAULT_POLICY.strip,
        maxDepth: DEFAULT_POLICY.maxDepth,
        maxLength: DEFAULT_POLICY.maxLength,
        protocols: [...DEFAULT_POLICY.protocols],
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
        .replace(/\n/g, '<br>');
    }

    // Sanitize through policy
    const clean = sanitize(html, policy);

    // Check overflow
    if (
      policy.maxLength > 0 &&
      (element.textContent?.length ?? 0) + clean.length > policy.maxLength
    ) {
      emit('overflow', policy.maxLength);
    }

    // Insert via Selection/Range API (NOT execCommand('insertHTML'))
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const template = doc.createElement('template');
    template.innerHTML = clean;
    const fragment = template.content;

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

    emit('paste', clean);
    emit('change', element.innerHTML);
  }

  // Input handler for change events
  function onInput(): void {
    emit('change', element.innerHTML);
    options?.onChange?.(element.innerHTML);
  }

  element.addEventListener('paste', onPaste);
  element.addEventListener('input', onInput);

  const editor: Editor = {
    exec(command: string, value?: string): void {
      // Validate command
      const supported = [
        'bold',
        'italic',
        'heading',
        'blockquote',
        'unorderedList',
        'orderedList',
        'link',
        'unlink',
        'codeBlock',
      ];
      if (!supported.includes(command)) {
        throw new Error(`Unknown editor command: "${command}"`);
      }

      element.focus();
      let success = false;

      switch (command) {
        case 'bold':
          success = doc.execCommand('bold', false);
          break;
        case 'italic':
          success = doc.execCommand('italic', false);
          break;
        case 'heading': {
          const level = value ?? '1';
          if (!['1', '2', '3'].includes(level)) {
            throw new Error(`Invalid heading level: "${level}". Use 1, 2, or 3`);
          }
          success = doc.execCommand('formatBlock', false, `<h${level}>`);
          break;
        }
        case 'blockquote':
          success = doc.execCommand('formatBlock', false, '<blockquote>');
          break;
        case 'unorderedList':
          success = doc.execCommand('insertUnorderedList', false);
          break;
        case 'orderedList':
          success = doc.execCommand('insertOrderedList', false);
          break;
        case 'link': {
          if (!value) {
            throw new Error('Link command requires a URL value');
          }
          // Validate URL protocol before creating link
          const trimmed = value.trim();
          // Use shared protocol validation logic inline to stay lightweight
          // javascript: and data: are always blocked by the sanitizer/observer,
          // but we reject them here too for immediate feedback
          const protoMatch = trimmed.match(/^([a-z][a-z0-9+\-.]*)\s*:/i);
          if (protoMatch) {
            const proto = protoMatch[1].toLowerCase();
            if (proto === 'javascript' || proto === 'data') {
              emit('error', new Error(`Blocked protocol: ${proto}`));
              return;
            }
            if (!policy.protocols.includes(proto)) {
              emit('error', new Error(`Protocol not allowed: ${proto}`));
              return;
            }
          }
          success = doc.execCommand('createLink', false, trimmed);
          break;
        }
        case 'unlink':
          success = doc.execCommand('unlink', false);
          break;
        case 'codeBlock':
          // Handled in Day 7
          success = doc.execCommand('formatBlock', false, '<pre>');
          break;
      }

      if (!success) {
        emit('error', new Error(`Command "${command}" failed`));
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
