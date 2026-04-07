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

const DEFAULT_ACTIONS = [
  'bold',
  'italic',
  'heading',
  'unorderedList',
  'orderedList',
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

  for (const action of actions) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `minisiwyg-btn minisiwyg-btn-${action}`;
    const label = ACTION_LABELS[action] ?? action;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = label;

    // Only first button is in tab order; rest use arrow keys
    btn.tabIndex = buttons.length === 0 ? 0 : -1;

    btn.addEventListener('click', () => onButtonClick(action));

    container.appendChild(btn);
    buttons.push(btn);
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
      const action = actions[i];
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
