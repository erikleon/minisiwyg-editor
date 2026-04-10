import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createToolbar } from '../src/toolbar';
import type { Editor, Toolbar } from '../src/types';

function createMockEditor(): Editor {
  return {
    exec: vi.fn(),
    queryState: vi.fn(() => false),
    getHTML: vi.fn(() => ''),
    getText: vi.fn(() => ''),
    destroy: vi.fn(),
    on: vi.fn(),
  };
}

describe('createToolbar', () => {
  let editor: Editor;
  let toolbar: Toolbar;

  beforeEach(() => {
    editor = createMockEditor();
    document.body.innerHTML = '<div id="editor" contenteditable="true"></div>';
  });

  afterEach(() => {
    toolbar?.destroy();
    document.body.innerHTML = '';
  });

  it('renders with correct ARIA roles', () => {
    toolbar = createToolbar(editor);
    expect(toolbar.element.getAttribute('role')).toBe('toolbar');
    expect(toolbar.element.getAttribute('aria-label')).toBe('Text formatting');
  });

  it('renders default actions as buttons', () => {
    toolbar = createToolbar(editor);
    const buttons = toolbar.element.querySelectorAll('button');
    expect(buttons.length).toBe(7); // bold, italic, heading, unorderedList, orderedList, link, codeBlock
  });

  it('each button has correct aria-label', () => {
    toolbar = createToolbar(editor);
    const buttons = toolbar.element.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Bold',
      'Italic',
      'Heading',
      'Bulleted list',
      'Numbered list',
      'Link',
      'Code block',
    ]);
  });

  it('click on bold button calls editor.exec("bold")', () => {
    toolbar = createToolbar(editor);
    const boldBtn = toolbar.element.querySelector('.minisiwyg-btn-bold') as HTMLButtonElement;
    boldBtn.click();
    expect(editor.exec).toHaveBeenCalledWith('bold');
  });

  it('click on italic button calls editor.exec("italic")', () => {
    toolbar = createToolbar(editor);
    const italicBtn = toolbar.element.querySelector('.minisiwyg-btn-italic') as HTMLButtonElement;
    italicBtn.click();
    expect(editor.exec).toHaveBeenCalledWith('italic');
  });

  it('link button prompts for URL and calls editor.exec("link", url)', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    toolbar = createToolbar(editor);
    const linkBtn = toolbar.element.querySelector('.minisiwyg-btn-link') as HTMLButtonElement;
    linkBtn.click();
    expect(promptSpy).toHaveBeenCalledWith('Enter URL');
    expect(editor.exec).toHaveBeenCalledWith('link', 'https://example.com');
    promptSpy.mockRestore();
  });

  it('link button does nothing when prompt is cancelled', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    toolbar = createToolbar(editor);
    const linkBtn = toolbar.element.querySelector('.minisiwyg-btn-link') as HTMLButtonElement;
    linkBtn.click();
    expect(editor.exec).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('arrow keys navigate between buttons', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const buttons = toolbar.element.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const second = buttons[1] as HTMLButtonElement;

    // First button should be focusable
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);

    // Focus first, press ArrowRight
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it('arrow keys wrap around', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const buttons = toolbar.element.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const last = buttons[buttons.length - 1] as HTMLButtonElement;

    // Press ArrowLeft on first button wraps to last
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(last.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it('updates aria-pressed on click based on queryState', () => {
    (editor.queryState as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string) => cmd === 'bold',
    );
    toolbar = createToolbar(editor);
    const boldBtn = toolbar.element.querySelector('.minisiwyg-btn-bold') as HTMLButtonElement;
    boldBtn.click();
    expect(boldBtn.getAttribute('aria-pressed')).toBe('true');
    expect(boldBtn.classList.contains('minisiwyg-btn-active')).toBe(true);
  });

  it('default actions render separators between groups', () => {
    toolbar = createToolbar(editor);
    const seps = toolbar.element.querySelectorAll('.minisiwyg-separator');
    expect(seps.length).toBe(3);
    seps.forEach((s) => {
      expect(s.getAttribute('role')).toBe('separator');
      expect(s.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  it('separators do not interfere with arrow-key navigation', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const buttons = toolbar.element.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const second = buttons[1] as HTMLButtonElement;

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(second.tabIndex).toBe(0);
  });

  it('buttons render an SVG icon for default actions', () => {
    toolbar = createToolbar(editor);
    const boldBtn = toolbar.element.querySelector('.minisiwyg-btn-bold') as HTMLButtonElement;
    expect(boldBtn.querySelector('svg')).not.toBeNull();
    expect(boldBtn.title).toBe('Bold');
  });

  it('custom actions accept "|" separator', () => {
    toolbar = createToolbar(editor, { actions: ['bold', '|', 'italic'] });
    expect(toolbar.element.querySelectorAll('button').length).toBe(2);
    expect(toolbar.element.querySelectorAll('.minisiwyg-separator').length).toBe(1);
  });

  it('custom actions list renders subset of buttons', () => {
    toolbar = createToolbar(editor, { actions: ['bold', 'italic'] });
    const buttons = toolbar.element.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-label')).toBe('Bold');
    expect(buttons[1].getAttribute('aria-label')).toBe('Italic');
  });

  it('empty actions array renders empty container', () => {
    toolbar = createToolbar(editor, { actions: [] });
    const buttons = toolbar.element.querySelectorAll('button');
    expect(buttons.length).toBe(0);
    expect(toolbar.element.getAttribute('role')).toBe('toolbar');
  });

  it('renders into user-provided element', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    toolbar = createToolbar(editor, { element: wrapper });
    expect(toolbar.element).toBe(wrapper);
    expect(wrapper.getAttribute('role')).toBe('toolbar');
    expect(wrapper.querySelectorAll('button').length).toBe(7);
  });

  it('destroy removes buttons and cleans up', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    expect(toolbar.element.querySelectorAll('button').length).toBe(7);
    toolbar.destroy();
    expect(toolbar.element.querySelectorAll('button').length).toBe(0);
  });

  it('buttons have correct CSS classes', () => {
    toolbar = createToolbar(editor);
    const btn = toolbar.element.querySelector('button');
    expect(btn?.classList.contains('minisiwyg-btn')).toBe(true);
    expect(btn?.classList.contains('minisiwyg-btn-bold')).toBe(true);
  });

  it('Home key moves focus to first button', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const buttons = toolbar.element.querySelectorAll('button');
    const third = buttons[2] as HTMLButtonElement;

    // Move focus to third button first
    third.tabIndex = 0;
    third.focus();
    third.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect((buttons[0] as HTMLButtonElement).tabIndex).toBe(0);
  });

  it('End key moves focus to last button', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const buttons = toolbar.element.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const last = buttons[buttons.length - 1] as HTMLButtonElement;

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(last.tabIndex).toBe(0);
  });

  it('link button rejects javascript: URLs', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');
    toolbar = createToolbar(editor);
    const linkBtn = toolbar.element.querySelector('.minisiwyg-btn-link') as HTMLButtonElement;
    linkBtn.click();
    expect(editor.exec).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('link button rejects data: URLs', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('data:text/html,<script>alert(1)</script>');
    toolbar = createToolbar(editor);
    const linkBtn = toolbar.element.querySelector('.minisiwyg-btn-link') as HTMLButtonElement;
    linkBtn.click();
    expect(editor.exec).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('handles queryState throwing without crashing', () => {
    (editor.queryState as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'heading') throw new Error('Unknown command');
      return cmd === 'bold';
    });
    toolbar = createToolbar(editor, { actions: ['bold', 'heading', 'italic'] });
    const boldBtn = toolbar.element.querySelector('.minisiwyg-btn-bold') as HTMLButtonElement;
    boldBtn.click();
    expect(boldBtn.getAttribute('aria-pressed')).toBe('true');
    const headingBtn = toolbar.element.querySelector('.minisiwyg-btn-heading') as HTMLButtonElement;
    expect(headingBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('destroy removes selectionchange listener', () => {
    toolbar = createToolbar(editor);
    document.body.appendChild(toolbar.element);
    const boldBtn = toolbar.element.querySelector('.minisiwyg-btn-bold') as HTMLButtonElement;
    boldBtn.click();
    const callCount = (editor.queryState as ReturnType<typeof vi.fn>).mock.calls.length;
    toolbar.destroy();
    document.dispatchEvent(new Event('selectionchange'));
    expect((editor.queryState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });
});
