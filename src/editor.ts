import type {
  SanitizePolicy,
  EditorOptions,
  Editor,
  Plugin,
  PluginCommand,
  PluginContext,
} from './types';
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
  'underline',
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

  const plugins: Plugin[] = options?.plugins ?? [];
  const pluginCommands = new Map<string, PluginCommand>();
  for (const plugin of plugins) {
    const delta = plugin.policy;
    if (delta?.tags) {
      for (const [tag, attrs] of Object.entries(delta.tags)) {
        if (tag !== tag.toLowerCase()) {
          throw new Error(
            `plugin '${plugin.name}' tag '${tag}' must be lowercase`,
          );
        }
        policy.tags[tag] = [...new Set([...(policy.tags[tag] ?? []), ...attrs])];
      }
    }
    if (delta?.protocols) {
      policy.protocols = [...new Set([...policy.protocols, ...delta.protocols])];
    }
    if (plugin.commands) {
      for (const [name, cmd] of Object.entries(plugin.commands)) {
        if (SUPPORTED_COMMANDS.has(name) || pluginCommands.has(name)) {
          throw new Error(
            `plugin '${plugin.name}' duplicates command '${name}'`,
          );
        }
        pluginCommands.set(name, cmd);
      }
    }
  }

  const handlers: Record<string, EventHandler[]> = {};
  const doc = element.ownerDocument;

  function emit(event: EditorEvent, ...args: unknown[]): void {
    for (const handler of handlers[event] ?? []) {
      handler(...args);
    }
  }

  // Notify both subscription paths (editor.on('change') and options.onChange)
  // for programmatic edits that don't fire 'input' (codeBlock toggle, list unwrap).
  function emitChange(): void {
    const html = element.innerHTML;
    emit('change', html);
    options?.onChange?.(html);
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

    // Inside code block: paste as plain text only
    const sel = doc.getSelection();
    if (sel && sel.rangeCount > 0 && sel.anchorNode) {
      const pre = findAncestor(sel.anchorNode, 'PRE');
      if (pre) {
        const text = clipboard.getData('text/plain');
        if (!text) return;
        if (policy.maxLength > 0) {
          const currentLen = element.textContent?.length ?? 0;
          if (currentLen + text.length > policy.maxLength) {
            emit('overflow', policy.maxLength);
          }
        }
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = doc.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        emit('paste', element.innerHTML);
        emitChange();
        return;
      }
    }

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
    emitChange();
  }

  // Input handler for change events
  function onInput(): void {
    emitChange();
  }

  // Keydown handler for code block behavior
  function onKeydown(e: KeyboardEvent): void {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;

    const pre = findAncestor(anchor, 'PRE');

    if (e.key === 'Enter' && pre) {
      // Insert newline instead of new paragraph
      e.preventDefault();
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = doc.createTextNode('\n');
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      emitChange();
    }

    if (e.key === 'Backspace' && pre) {
      // At start of empty pre, convert to <p>
      const text = pre.textContent || '';
      const isAtStart = sel.anchorOffset === 0;
      const isEmpty = text === '' || text === '\n';
      if (isAtStart && isEmpty) {
        e.preventDefault();
        const p = doc.createElement('p');
        p.appendChild(doc.createElement('br'));
        pre.parentNode?.replaceChild(p, pre);
        const range = doc.createRange();
        range.selectNodeContents(p);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        emitChange();
      }
    }
  }

  element.addEventListener('keydown', onKeydown);
  element.addEventListener('paste', onPaste);
  element.addEventListener('input', onInput);

  function findAncestor(node: Node, tagName: string): Element | null {
    let current: Node | null = node;
    while (current && current !== element) {
      if (current.nodeType === 1 && (current as Element).tagName === tagName) return current as Element;
      current = current.parentNode;
    }
    return null;
  }

  /**
   * Manually unwrap a list the selection is inside of, replacing each
   * <li> with a <p>. Returns true if an unwrap happened.
   *
   * We do this instead of relying on execCommand toggle-off because
   * browsers unwrap list items into <div> wrappers, which the policy
   * enforcer then strips (losing content).
   */
  function unwrapList(tag: 'UL' | 'OL'): boolean {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const anchor = sel.anchorNode;
    if (!anchor) return false;
    const list = findAncestor(anchor, tag);
    if (!list) return false;

    const anchorLi = findAncestor(anchor, 'LI');
    const parent = list.parentNode;
    if (!parent) return false;

    const paragraphs: HTMLParagraphElement[] = [];
    let focusTarget: HTMLParagraphElement | null = null;

    for (const child of Array.from(list.childNodes)) {
      if (child.nodeType !== 1 || (child as Element).tagName !== 'LI') continue;
      const p = doc.createElement('p');
      while (child.firstChild) p.appendChild(child.firstChild);
      if (!p.firstChild) p.appendChild(doc.createElement('br'));
      paragraphs.push(p);
      if (child === anchorLi) focusTarget = p;
    }

    for (const p of paragraphs) parent.insertBefore(p, list);
    parent.removeChild(list);

    const target = focusTarget ?? paragraphs[0];
    if (target) {
      const r = doc.createRange();
      r.selectNodeContents(target);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    emitChange();
    return true;
  }

  function hasAncestor(node: Node, tagName: string): boolean {
    let current: Node | null = node;
    while (current && current !== element) {
      if (current.nodeType === 1 && (current as Element).tagName === tagName) return true;
      current = current.parentNode;
    }
    return false;
  }

  function toggleInline(tagName: string): void {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;

    const upperTag = tagName.toUpperCase();
    // Check both anchor and focus to handle backward (right-to-left) selections
    const nodeInTag = hasAncestor(anchor, upperTag)
      ? anchor
      : (sel.focusNode && hasAncestor(sel.focusNode, upperTag) ? sel.focusNode : null);
    if (nodeInTag) {
      const wrapper = findAncestor(nodeInTag, upperTag);
      if (!wrapper) return;
      const parent = wrapper.parentNode;
      if (!parent) return;
      const firstChild = wrapper.firstChild;
      const lastChild = wrapper.lastChild;
      const frag = doc.createDocumentFragment();
      while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
      parent.replaceChild(frag, wrapper);
      // Restore selection over the unwrapped content
      if (firstChild) {
        const newRange = doc.createRange();
        newRange.setStartBefore(firstChild);
        if (lastChild) newRange.setEndAfter(lastChild);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    } else {
      const el = doc.createElement(tagName);
      try {
        range.surroundContents(el);
      } catch {
        el.appendChild(range.extractContents());
        range.insertNode(el);
      }
      const newRange = doc.createRange();
      newRange.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    emitChange();
  }

  function replaceBlock(anchor: Node, newTag: string): void {
    let block: Node | null = anchor;
    while (block && block !== element && block.parentNode !== element) {
      block = block.parentNode;
    }
    if (!block || block === element) return;
    const oldEl = block as Element;
    const newEl = doc.createElement(newTag);
    while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
    oldEl.parentNode!.replaceChild(newEl, oldEl);
    const sel = doc.getSelection();
    if (sel) {
      const r = doc.createRange();
      r.selectNodeContents(newEl);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    emitChange();
  }

  function wrapInList(listTag: 'ul' | 'ol'): void {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;
    let block: Node | null = anchor;
    while (block && block !== element && block.parentNode !== element) {
      block = block.parentNode;
    }
    if (!block || block === element) return;
    const list = doc.createElement(listTag);
    const li = doc.createElement('li');
    const blockEl = block as Element;
    while (blockEl.firstChild) li.appendChild(blockEl.firstChild);
    list.appendChild(li);
    blockEl.parentNode!.replaceChild(list, blockEl);
    const r = doc.createRange();
    r.selectNodeContents(li);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    emitChange();
  }

  function convertList(existingList: Element, newTag: 'ul' | 'ol'): void {
    const newList = doc.createElement(newTag);
    const children = Array.from(existingList.children).filter(c => c.tagName === 'LI');
    for (const li of children) newList.appendChild(li);
    existingList.parentNode!.replaceChild(newList, existingList);
    const sel = doc.getSelection();
    if (sel) {
      const r = doc.createRange();
      r.selectNodeContents(newList);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    emitChange();
  }

  const pluginCtx: PluginContext = {
    element,
    doc,
    policy,
    emit(event: string, ...args: unknown[]): void {
      if (event === 'change') {
        emitChange();
      } else {
        emit(event as EditorEvent, ...args);
      }
    },
  };

  const editor: Editor = {
    exec(command: string, value?: string): void {
      const pcmd = pluginCommands.get(command);
      if (pcmd) {
        element.focus();
        pcmd.exec(pluginCtx, value);
        return;
      }
      if (!SUPPORTED_COMMANDS.has(command)) {
        throw new Error(`Unknown editor command: "${command}"`);
      }

      element.focus();

      switch (command) {
        case 'bold':
          toggleInline('strong');
          break;
        case 'italic':
          toggleInline('em');
          break;
        case 'underline':
          toggleInline('u');
          break;
        case 'heading': {
          const level = value ?? '1';
          if (!['1', '2', '3'].includes(level)) {
            throw new Error(`Invalid heading level: "${level}". Use 1, 2, or 3`);
          }
          const tag = `H${level}`;
          const anchor = doc.getSelection()?.anchorNode;
          if (!anchor) break;
          if (editor.queryState('heading') && hasAncestor(anchor, tag)) {
            replaceBlock(anchor, 'p');
          } else {
            replaceBlock(anchor, `h${level}`);
          }
          break;
        }
        case 'blockquote': {
          const anchor = doc.getSelection()?.anchorNode;
          if (!anchor) break;
          if (editor.queryState('blockquote')) {
            replaceBlock(anchor, 'p');
          } else {
            replaceBlock(anchor, 'blockquote');
          }
          break;
        }
        case 'unorderedList': {
          if (!unwrapList('UL')) {
            const anchor = doc.getSelection()?.anchorNode;
            const olEl = anchor ? findAncestor(anchor, 'OL') : null;
            if (olEl) {
              convertList(olEl, 'ul');
            } else {
              wrapInList('ul');
            }
          }
          break;
        }
        case 'orderedList': {
          if (!unwrapList('OL')) {
            const anchor = doc.getSelection()?.anchorNode;
            const ulEl = anchor ? findAncestor(anchor, 'UL') : null;
            if (ulEl) {
              convertList(ulEl, 'ol');
            } else {
              wrapInList('ol');
            }
          }
          break;
        }
        case 'link': {
          if (!value) {
            throw new Error('Link command requires a URL value');
          }
          const trimmed = value.trim();
          if (!isProtocolAllowed(trimmed, policy.protocols)) {
            emit('error', new Error(`Protocol not allowed: ${trimmed}`));
            return;
          }
          const sel2 = doc.getSelection();
          if (!sel2 || sel2.rangeCount === 0) break;
          const linkRange = sel2.getRangeAt(0);
          const a = doc.createElement('a');
          a.href = trimmed;
          if (linkRange.collapsed) {
            a.textContent = trimmed;
            linkRange.insertNode(a);
            const newRange = doc.createRange();
            newRange.setStartAfter(a);
            newRange.collapse(true);
            sel2.removeAllRanges();
            sel2.addRange(newRange);
          } else {
            try {
              linkRange.surroundContents(a);
            } catch {
              a.appendChild(linkRange.extractContents());
              linkRange.insertNode(a);
            }
            const newRange = doc.createRange();
            newRange.selectNodeContents(a);
            sel2.removeAllRanges();
            sel2.addRange(newRange);
          }
          emitChange();
          break;
        }
        case 'unlink': {
          const anchor = doc.getSelection()?.anchorNode;
          if (!anchor) break;
          const aEl = findAncestor(anchor, 'A');
          if (!aEl) break;
          const parent = aEl.parentNode;
          if (!parent) break;
          const firstChild = aEl.firstChild;
          const lastChild = aEl.lastChild;
          const frag = doc.createDocumentFragment();
          while (aEl.firstChild) frag.appendChild(aEl.firstChild);
          parent.replaceChild(frag, aEl);
          if (firstChild) {
            const sel3 = doc.getSelection();
            if (sel3) {
              const newRange = doc.createRange();
              newRange.setStartBefore(firstChild);
              if (lastChild) newRange.setEndAfter(lastChild);
              sel3.removeAllRanges();
              sel3.addRange(newRange);
            }
          }
          emitChange();
          break;
        }
        case 'codeBlock': {
          const sel = doc.getSelection();
          if (!sel || sel.rangeCount === 0) break;
          const anchor = sel.anchorNode;
          const pre = anchor ? findAncestor(anchor, 'PRE') : null;
          if (pre) {
            // Toggle off: unwrap <pre><code> to <p>
            const p = doc.createElement('p');
            p.textContent = pre.textContent || '';
            pre.parentNode?.replaceChild(p, pre);
            const r = doc.createRange();
            r.selectNodeContents(p);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          } else {
            // Wrap current block in <pre><code>
            const range = sel.getRangeAt(0);
            let block = range.startContainer;
            while (block.parentNode && block.parentNode !== element) {
              block = block.parentNode;
            }
            const pre2 = doc.createElement('pre');
            const code = doc.createElement('code');
            const blockText = block.textContent || '';
            code.textContent = blockText.endsWith('\n') ? blockText : blockText + '\n';
            pre2.appendChild(code);
            if (block.parentNode === element) {
              element.replaceChild(pre2, block);
            } else {
              element.appendChild(pre2);
            }
            const r = doc.createRange();
            r.selectNodeContents(code);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
          emitChange();
          break;
        }
      }
    },

    queryState(command: string): boolean {
      const pcmd = pluginCommands.get(command);
      if (pcmd) return pcmd.queryState?.(pluginCtx) ?? false;
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
        case 'underline':
          return hasAncestor(node, 'U');
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
      element.removeEventListener('keydown', onKeydown);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('input', onInput);
      enforcer.destroy();
      element.contentEditable = 'false';
    },

    on(event: string, handler: EventHandler): void {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },

    element,
  };

  return editor;
}
