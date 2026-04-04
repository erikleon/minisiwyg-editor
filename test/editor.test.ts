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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
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
    expect((errors[0] as Error).message).toContain('Blocked protocol');
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
    expect((errors[0] as Error).message).toContain('Blocked protocol');
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

  it('destroy removes paste and input listeners', async () => {
    const onChange = vi.fn();
    const editor = createEditor(container, { onChange });
    editor.destroy();

    container.innerHTML = '<p>typed</p>';
    container.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
