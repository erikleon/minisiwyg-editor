import type { Editor, ToolbarOptions, Toolbar } from './types';
import { isProtocolAllowed } from './shared';
import { DEFAULT_POLICY } from './defaults';

export type { ToolbarOptions, Toolbar } from './types';

const ACTION_LABELS: Record<string, string> = {
  bold: 'Bold',
  italic: 'Italic',
  heading: 'Heading',
  blockquote: 'Blockquote',
  unorderedList: 'Bulleted list',
  orderedList: 'Numbered list',
  link: 'Link',
  unlink: 'Remove link',
  codeBlock: 'Code block',
};

// Inline SVG path data for each action. Rendered inside a shared <svg> wrapper
// so gzip dedupes the boilerplate. viewBox is 20x20, stroke-based.
const ICONS: Record<string, string> = {
  bold: '<path fill="currentColor" d="M6 4h5a3 3 0 010 6H6zm0 6h6a3 3 0 010 6H6z"/>',
  italic: '<path d="M8 4h8M6 16h8M13 4l-4 12"/>',
  heading: '<path d="M5 4v12M13 4v12M5 10h8"/>',
  blockquote: '<path d="M5 8q0-3 3-4M12 8q0-3 3-4M4 10h4v4H4zM11 10h4v4h-4z"/>',
  unorderedList: '<path d="M7 6h11M7 10h11M7 14h11"/><circle fill="currentColor" cx="3.5" cy="6" r="1.2"/><circle fill="currentColor" cx="3.5" cy="10" r="1.2"/><circle fill="currentColor" cx="3.5" cy="14" r="1.2"/>',
  orderedList: '<path d="M8 6h10M8 10h10M8 14h10M3 4v4M2 14h2M2 12a1 1 0 012 0c0 1-2 1-2 3h2"/>',
  link: '<path d="M9 11a3 3 0 004 0l2-2a3 3 0 00-4-4l-1 1M11 9a3 3 0 00-4 0l-2 2a3 3 0 004 4l1-1"/>',
  unlink: '<path d="M9 11a3 3 0 004 0l2-2a3 3 0 00-4-4l-1 1M11 9a3 3 0 00-4 0l-2 2a3 3 0 004 4l1-1M3 3l14 14"/>',
  codeBlock: '<path d="M8 6l-4 4 4 4M12 6l4 4-4 4"/>',
};

const SVG_OPEN =
  '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

const DEFAULT_ACTIONS = [
  'bold',
  'italic',
  '|',
  'heading',
  '|',
  'unorderedList',
  'orderedList',
  '|',
  'link',
  'codeBlock',
];

/**
 * Create a toolbar that drives an Editor instance.
 *
 * Renders a `<div role="toolbar">` with buttons for each action.
 * Supports ARIA roles, keyboard navigation (arrow keys between
 * buttons, Tab exits), and active-state tracking via selectionchange.
 */
export function createToolbar(
  editor: Editor,
  options?: ToolbarOptions,
): Toolbar {
  const actions = options?.actions ?? DEFAULT_ACTIONS;
  const doc = document;

  // Container
  const container = options?.element ?? doc.createElement('div');
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Text formatting');
  container.classList.add('minisiwyg-toolbar');

  const buttons: HTMLButtonElement[] = [];
  const buttonActions: string[] = [];

  for (const action of actions) {
    if (action === '|' || action === 'separator') {
      const sep = doc.createElement('span');
      sep.className = 'minisiwyg-separator';
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'vertical');
      container.appendChild(sep);
      continue;
    }

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `minisiwyg-btn minisiwyg-btn-${action}`;
    const label = ACTION_LABELS[action] ?? action;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.title = label;
    const icon = ICONS[action];
    if (icon) {
      btn.innerHTML = SVG_OPEN + icon + '</svg>';
    } else {
      btn.textContent = label;
    }

    // Only first button is in tab order; rest use arrow keys
    btn.tabIndex = buttons.length === 0 ? 0 : -1;

    btn.addEventListener('click', () => onButtonClick(action));

    container.appendChild(btn);
    buttons.push(btn);
    buttonActions.push(action);
  }

  // Caller is responsible for placing toolbar.element in the DOM

  function onButtonClick(action: string): void {
    try {
      if (action === 'link') {
        const url = window.prompt('Enter URL')?.trim();
        if (!url) return;
        if (!isProtocolAllowed(url, DEFAULT_POLICY.protocols)) return;
        editor.exec('link', url);
      } else {
        editor.exec(action);
      }
    } catch {
      // Unknown or invalid commands — don't crash the toolbar
    }
    updateActiveStates();
  }

  function updateActiveStates(): void {
    for (let i = 0; i < buttons.length; i++) {
      const action = buttonActions[i];
      try {
        const active = editor.queryState(action);
        buttons[i].setAttribute('aria-pressed', String(active));
        buttons[i].classList.toggle('minisiwyg-btn-active', active);
      } catch {
        // queryState may throw for unknown commands; ignore
      }
    }
  }

  // Keyboard navigation within toolbar
  function onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const idx = buttons.indexOf(target as HTMLButtonElement);
    if (idx === -1) return;

    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = (idx + 1) % buttons.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = (idx - 1 + buttons.length) % buttons.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      next = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      next = buttons.length - 1;
    }

    if (next >= 0) {
      buttons[idx].tabIndex = -1;
      buttons[next].tabIndex = 0;
      buttons[next].focus();
    }
  }

  container.addEventListener('keydown', onKeydown);

  // Track selection changes to update active states (debounced to one per frame)
  let rafId = 0;
  function onSelectionChange(): void {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(updateActiveStates);
  }

  doc.addEventListener('selectionchange', onSelectionChange);

  // Return the container element for the caller to place in the DOM
  const toolbar: Toolbar = {
    element: container,
    destroy(): void {
      cancelAnimationFrame(rafId);
      container.removeEventListener('keydown', onKeydown);
      doc.removeEventListener('selectionchange', onSelectionChange);
      // Remove buttons
      for (const btn of buttons) {
        btn.remove();
      }
      // Remove container if we created it (not user-provided)
      if (!options?.element) {
        container.remove();
      }
      buttons.length = 0;
    },
  };

  return toolbar;
}
