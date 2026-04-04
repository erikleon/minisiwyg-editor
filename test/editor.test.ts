import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEditor } from '../src/editor';
import { DEFAULT_POLICY } from '../src/defaults';
import type { SanitizePolicy } from '../src/types';

function makePolicy(overrides?: Partial<SanitizePolicy>): SanitizePolicy {
  return {
    tags: { ...DEFAULT_POLICY.tags },
    strip: DEFAULT_POLICY.strip,
    maxDepth: DEFAULT_POLICY.maxDepth,
    maxLength: DEFAULT_POLICY.maxLength,
    protocols: [...DEFAULT_POLICY.protocols],
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create a mock ClipboardEvent with the given data.
 */
function createPasteEvent(data: Record<string, string>): ClipboardEvent {
  const clipboardData = {
    getData(type: string) {
      return data[type] ?? '';
    },
  } as DataTransfer;

  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });

  // happy-dom may not support clipboardData in constructor, so override
  Object.defineProperty(event, 'clipboardData', {
    value: clipboardData,
    writable: false,
  });

  return event;
}

/**
 * Place cursor inside the element (select all content).
 */
function selectAll(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Place cursor at the end of the element.
 */
function cursorToEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('Editor Core', () => {
  let container: HTMLDivElement;

  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.execCommand = originalExecCommand;
    document.body.removeChild(container);
  });

  it('initializes with contentEditable', () => {
    const editor = createEditor(container);
    expect(container.contentEditable).toBe('true');
    editor.destroy();
  });

  it('destroy() removes contentEditable and cleans up', () => {
    const editor = createEditor(container);
    editor.destroy();
    expect(container.contentEditable).toBe('false');
  });

  it('getHTML() returns current content', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello</p>';
    expect(editor.getHTML()).toBe('<p>hello</p>');
    editor.destroy();
  });

  it('getText() returns text only', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello <strong>world</strong></p>';
    expect(editor.getText()).toBe('hello world');
    editor.destroy();
  });

  it('paste event is intercepted and sanitized', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/html': '<p>safe</p><div>removed</div>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.innerHTML).toContain('<p>safe</p>');
    expect(container.querySelector('div')).toBeNull();
    editor.destroy();
  });

  it('paste with XSS payload produces clean output', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/html': '<p>safe</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">xss</a>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    const html = container.innerHTML;
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<p>safe</p>');
    editor.destroy();
  });

  it('paste of plain text works correctly', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/plain': 'hello world',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.textContent).toContain('hello world');
    editor.destroy();
  });

  it('paste of plain text escapes HTML entities', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/plain': '<script>alert(1)</script>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    editor.destroy();
  });

  it('paste of plain text converts newlines to <br>', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/plain': 'line1\nline2\nline3',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.innerHTML).toContain('<br>');
    expect(container.textContent).toContain('line1');
    expect(container.textContent).toContain('line2');
    editor.destroy();
  });

  it('onChange callback fires on content changes', async () => {
    const onChange = vi.fn();
    const editor = createEditor(container, { onChange });

    // Simulate input event
    container.innerHTML = '<p>typed</p>';
    container.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('<p>typed</p>');
    editor.destroy();
  });

  it('paste emits change and paste events', async () => {
    const onPaste = vi.fn();
    const onChange = vi.fn();
    const editor = createEditor(container);
    editor.on('paste', onPaste);
    editor.on('change', onChange);

    cursorToEnd(container);
    const pasteEvent = createPasteEvent({
      'text/html': '<p>content</p>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(onPaste).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
    editor.destroy();
  });

  it('paste respecting maxLength emits overflow', async () => {
    const policy = makePolicy({ maxLength: 5 });
    const editor = createEditor(container, { policy });
    const onOverflow = vi.fn();
    editor.on('overflow', onOverflow);

    container.textContent = 'abc';
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/plain': 'defghijk',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(onOverflow).toHaveBeenCalledWith(5);
    editor.destroy();
  });

  it('multiple consecutive pastes work correctly', async () => {
    const editor = createEditor(container);

    cursorToEnd(container);
    container.dispatchEvent(
      createPasteEvent({ 'text/html': '<p>first</p>' }),
    );
    await flush();

    cursorToEnd(container);
    container.dispatchEvent(
      createPasteEvent({ 'text/html': '<p>second</p>' }),
    );
    await flush();

    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
    editor.destroy();
  });

  it('createEditor with null element throws helpful error', () => {
    expect(() => {
      createEditor(null as unknown as HTMLElement);
    }).toThrow('createEditor requires an HTMLElement');
  });

  it('createEditor with detached element throws helpful error', () => {
    const detached = document.createElement('div');
    expect(() => {
      createEditor(detached);
    }).toThrow('createEditor requires an element attached to the DOM');
  });

  it('exec with unknown command throws helpful error', () => {
    const editor = createEditor(container);
    expect(() => {
      editor.exec('nonexistent');
    }).toThrow('Unknown editor command: "nonexistent"');
    editor.destroy();
  });

  it('link command rejects javascript: URLs', async () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    selectAll(container);
    editor.exec('link', 'javascript:alert(1)');

    await flush();
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toContain('Protocol not allowed');
    editor.destroy();
  });

  it('link command rejects data: URLs', async () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    selectAll(container);
    editor.exec('link', 'data:text/html,<script>alert(1)</script>');

    await flush();
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toContain('Protocol not allowed');
    editor.destroy();
  });

  it('link command rejects protocols not in policy', async () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    selectAll(container);
    editor.exec('link', 'ftp://example.com');

    await flush();
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toContain('Protocol not allowed');
    editor.destroy();
  });

  it('heading command rejects invalid levels', () => {
    const editor = createEditor(container);
    expect(() => {
      editor.exec('heading', '5');
    }).toThrow('Invalid heading level');
    editor.destroy();
  });

  it('link command requires a URL value', () => {
    const editor = createEditor(container);
    expect(() => {
      editor.exec('link');
    }).toThrow('Link command requires a URL value');
    editor.destroy();
  });

  it('paste with empty clipboard is silently ignored', async () => {
    const editor = createEditor(container);
    const onChange = vi.fn();
    editor.on('change', onChange);

    cursorToEnd(container);
    container.dispatchEvent(
      createPasteEvent({}),
    );

    await flush();
    expect(onChange).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('editor uses custom policy when provided', async () => {
    const policy = makePolicy({
      tags: { p: [], strong: [] },
    });
    const editor = createEditor(container, { policy });
    cursorToEnd(container);

    container.dispatchEvent(
      createPasteEvent({ 'text/html': '<p>ok</p><em>gone</em><a href="https://x.com">link</a>' }),
    );

    await flush();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    editor.destroy();
  });

  it('queryState for bold returns false when inactive', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>plain text</p>';
    cursorToEnd(container);
    expect(editor.queryState('bold')).toBe(false);
    editor.destroy();
  });

  it('queryState for bold returns true inside <strong>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><strong>bold text</strong></p>';
    // Place cursor inside the strong element
    const strong = container.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(strong.firstChild!, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(editor.queryState('bold')).toBe(true);
    editor.destroy();
  });

  it('queryState for italic returns true inside <em>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><em>italic text</em></p>';
    const em = container.querySelector('em')!;
    const range = document.createRange();
    range.setStart(em.firstChild!, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(editor.queryState('italic')).toBe(true);
    editor.destroy();
  });

  it('queryState for link returns true inside <a>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><a href="https://example.com">link</a></p>';
    const anchor = container.querySelector('a')!;
    const range = document.createRange();
    range.setStart(anchor.firstChild!, 1);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(editor.queryState('link')).toBe(true);
    editor.destroy();
  });

  it('queryState for link returns false outside <a>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>no link here</p>';
    cursorToEnd(container);
    expect(editor.queryState('link')).toBe(false);
    editor.destroy();
  });

  it('queryState for unlink always returns false', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><a href="https://example.com">link</a></p>';
    cursorToEnd(container);
    expect(editor.queryState('unlink')).toBe(false);
    editor.destroy();
  });

  it('queryState with unknown command throws', () => {
    const editor = createEditor(container);
    expect(() => editor.queryState('nonexistent')).toThrow('Unknown editor command');
    editor.destroy();
  });

  it('exec bold on selection calls execCommand', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('bold');
    expect(document.execCommand).toHaveBeenCalledWith('bold', false);
    editor.destroy();
  });

  it('exec italic on selection calls execCommand', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('italic');
    expect(document.execCommand).toHaveBeenCalledWith('italic', false);
    editor.destroy();
  });

  it('exec blockquote calls formatBlock', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>a quote</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('blockquote');
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<blockquote>');
    editor.destroy();
  });

  it('exec unorderedList calls insertUnorderedList', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>item</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('unorderedList');
    expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList', false);
    editor.destroy();
  });

  it('exec orderedList calls insertOrderedList', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>item</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('orderedList');
    expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList', false);
    editor.destroy();
  });

  it('exec heading with valid levels calls formatBlock', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>title</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('heading', '1');
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h1>');
    editor.exec('heading', '2');
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h2>');
    editor.exec('heading', '3');
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<h3>');
    editor.destroy();
  });

  it('exec codeBlock calls formatBlock with pre', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>code</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('codeBlock');
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<pre>');
    editor.destroy();
  });

  it('link command accepts valid https URL', () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('link', 'https://example.com');

    expect(errors.length).toBe(0);
    expect(document.execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.com');
    editor.destroy();
  });

  it('link command accepts mailto URL', () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    selectAll(container);
    document.execCommand = vi.fn(() => true);
    editor.exec('link', 'mailto:test@example.com');

    expect(errors.length).toBe(0);
    expect(document.execCommand).toHaveBeenCalledWith('createLink', false, 'mailto:test@example.com');
    editor.destroy();
  });

  it('formatting on empty container does not crash', () => {
    const editor = createEditor(container);
    document.execCommand = vi.fn(() => true);
    // No content, no selection — just verify no throw
    editor.exec('bold');
    editor.exec('italic');
    editor.exec('blockquote');
    editor.exec('unorderedList');
    editor.exec('orderedList');
    editor.exec('codeBlock');
    editor.destroy();
  });

  it('destroy removes paste and input listeners', async () => {
    const onChange = vi.fn();
    const editor = createEditor(container, { onChange });
    editor.destroy();

    container.innerHTML = '<p>typed</p>';
    container.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
