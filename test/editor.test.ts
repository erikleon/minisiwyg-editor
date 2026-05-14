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

  it('exec unlink removes the anchor element and preserves text', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><a href="https://example.com">link text</a></p>';
    const a = container.querySelector('a')!;
    const range = document.createRange();
    range.setStart(a.firstChild!, 1);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('unlink');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('link text');
    editor.destroy();
  });

  it('queryState with unknown command throws', () => {
    const editor = createEditor(container);
    expect(() => editor.queryState('nonexistent')).toThrow('Unknown editor command');
    editor.destroy();
  });

  it('exec bold on selection wraps in <strong>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('bold');
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('strong')!.textContent).toBe('hello world');
    editor.destroy();
  });

  it('exec italic on selection wraps in <em>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('italic');
    expect(container.querySelector('em')).not.toBeNull();
    expect(container.querySelector('em')!.textContent).toBe('hello world');
    editor.destroy();
  });

  it('exec underline on selection wraps in <u>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('underline');
    expect(container.querySelector('u')).not.toBeNull();
    expect(container.querySelector('u')!.textContent).toBe('hello world');
    editor.destroy();
  });

  it('queryState for underline returns true inside <u>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><u>underlined</u></p>';
    const u = container.querySelector('u')!;
    const range = document.createRange();
    range.setStart(u.firstChild!, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(editor.queryState('underline')).toBe(true);
    editor.destroy();
  });

  it('queryState for underline returns false outside <u>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>plain</p>';
    cursorToEnd(container);
    expect(editor.queryState('underline')).toBe(false);
    editor.destroy();
  });

  it('default policy preserves <u> tags on paste', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/html': '<p><u>under</u></p>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.querySelector('u')).not.toBeNull();
    expect(container.querySelector('u')!.textContent).toBe('under');
    editor.destroy();
  });

  it('exposes the contentEditable element via editor.element', () => {
    const editor = createEditor(container);
    expect(editor.element).toBe(container);
    editor.destroy();
  });

  it('exec blockquote wraps block in <blockquote>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>a quote</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('blockquote');
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.querySelector('blockquote')!.textContent).toBe('a quote');
    editor.destroy();
  });

  it('exec unorderedList wraps block in <ul><li>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>item</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('unorderedList');
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelector('ul li')).not.toBeNull();
    expect(container.querySelector('ul li')!.textContent).toBe('item');
    editor.destroy();
  });

  it('exec orderedList wraps block in <ol><li>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>item</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('orderedList');
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelector('ol li')).not.toBeNull();
    expect(container.querySelector('ol li')!.textContent).toBe('item');
    editor.destroy();
  });

  it('toggling off a <ul> unwraps items into <p> without losing content', () => {
    const editor = createEditor(container);
    container.innerHTML = '<ul><li>one</li><li>two</li></ul>';
    const li = container.querySelectorAll('li')[1]!;
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;
    editor.exec('unorderedList');

    // execCommand must NOT be called — we handle the unwrap ourselves
    expect(execSpy).not.toHaveBeenCalled();
    expect(container.querySelector('ul')).toBeNull();
    const ps = container.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe('one');
    expect(ps[1].textContent).toBe('two');
    editor.destroy();
  });

  it('toggling off a <ul> preserves inline formatting', () => {
    const editor = createEditor(container);
    container.innerHTML = '<ul><li><strong>bold</strong> text</li></ul>';
    const li = container.querySelector('li')!;
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    document.execCommand = vi.fn(() => true);
    editor.exec('unorderedList');

    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelector('p strong')?.textContent).toBe('bold');
    editor.destroy();
  });

  it('toggling off an <ol> unwraps items into <p>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<ol><li>first</li><li>second</li></ol>';
    const li = container.querySelector('li')!;
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;
    editor.exec('orderedList');

    expect(execSpy).not.toHaveBeenCalled();
    expect(container.querySelector('ol')).toBeNull();
    const ps = container.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe('first');
    editor.destroy();
  });

  it('orderedList exec inside a <ul> converts it to <ol>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<ul><li>item</li></ul>';
    const li = container.querySelector('li')!;
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    editor.exec('orderedList');
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelector('ol li')!.textContent).toBe('item');
    editor.destroy();
  });

  it('exec heading with valid levels wraps block in heading element', () => {
    const editor = createEditor(container);
    const sel = document.getSelection();

    container.innerHTML = '<p>title</p>';
    let target: Element = container.querySelector('p')!;
    let r = document.createRange();
    r.setStart(target.firstChild!, 0);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    editor.exec('heading', '1');
    expect(container.querySelector('h1')?.textContent).toBe('title');

    target = container.querySelector('h1')!;
    r = document.createRange();
    r.setStart(target.firstChild!, 0);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    editor.exec('heading', '2');
    expect(container.querySelector('h2')?.textContent).toBe('title');

    target = container.querySelector('h2')!;
    r = document.createRange();
    r.setStart(target.firstChild!, 0);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    editor.exec('heading', '3');
    expect(container.querySelector('h3')?.textContent).toBe('title');

    editor.destroy();
  });

  it('exec heading toggles off when already in the same heading level', () => {
    const editor = createEditor(container);
    container.innerHTML = '<h1>title</h1>';
    selectAll(container.querySelector('h1')!);
    editor.exec('heading', '1');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('p')!.textContent).toBe('title');
    editor.destroy();
  });

  it('exec heading switches level when in a different heading', () => {
    const editor = createEditor(container);
    container.innerHTML = '<h1>title</h1>';
    selectAll(container.querySelector('h1')!);
    editor.exec('heading', '2');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).not.toBeNull();
    expect(container.querySelector('h2')!.textContent).toBe('title');
    editor.destroy();
  });

  it('exec blockquote toggles off when already in a blockquote', () => {
    const editor = createEditor(container);
    container.innerHTML = '<blockquote>a quote</blockquote>';
    selectAll(container.querySelector('blockquote')!);
    editor.exec('blockquote');
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('p')!.textContent).toBe('a quote');
    editor.destroy();
  });

  it('exec codeBlock wraps in pre via DOM API', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>code</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('codeBlock');
    expect(container.querySelector('pre')).not.toBeNull();
    editor.destroy();
  });

  it('link command accepts valid https URL', () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('link', 'https://example.com');

    expect(errors.length).toBe(0);
    expect(container.querySelector('a')).not.toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
    editor.destroy();
  });

  it('link command accepts mailto URL', () => {
    const editor = createEditor(container);
    const errors: unknown[] = [];
    editor.on('error', (err) => errors.push(err));

    container.innerHTML = '<p>text</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('link', 'mailto:test@example.com');

    expect(errors.length).toBe(0);
    expect(container.querySelector('a')).not.toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe('mailto:test@example.com');
    editor.destroy();
  });

  it('formatting on empty container does not crash', () => {
    const editor = createEditor(container);
    // No content, no selection — just verify no throw
    editor.exec('bold');
    editor.exec('italic');
    editor.exec('blockquote');
    editor.exec('unorderedList');
    editor.exec('orderedList');
    editor.exec('codeBlock');
    editor.destroy();
  });

  it('exec codeBlock wraps content in pre>code', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello world</p>';
    // Place cursor inside the paragraph
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    editor.exec('codeBlock');

    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.querySelector('pre code')).not.toBeNull();
    expect(container.querySelector('pre code')!.textContent).toContain('hello world');
    editor.destroy();
  });

  it('exec codeBlock toggles off when inside pre', () => {
    const editor = createEditor(container);
    container.innerHTML = '<pre><code>some code</code></pre>';
    // Place cursor inside code element
    const code = container.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    editor.exec('codeBlock');

    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.textContent).toContain('some code');
    editor.destroy();
  });

  it('Enter inside code block inserts newline', () => {
    const editor = createEditor(container);
    container.innerHTML = '<pre><code>line1</code></pre>';
    const code = container.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 5);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('pre')!.textContent).toContain('\n');
    editor.destroy();
  });

  it('Backspace at start of empty code block converts to paragraph', () => {
    const editor = createEditor(container);
    container.innerHTML = '<pre><code>\n</code></pre>';
    const code = container.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    editor.destroy();
  });

  it('Backspace inside non-empty code block behaves normally', () => {
    const editor = createEditor(container);
    container.innerHTML = '<pre><code>abc</code></pre>';
    const code = container.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    // Should NOT be prevented — let browser handle normal backspace
    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('pre')).not.toBeNull();
    editor.destroy();
  });

  it('paste inside code block strips formatting', async () => {
    const editor = createEditor(container);
    container.innerHTML = '<pre><code>existing</code></pre>';
    const code = container.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 8);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const pasteEvent = createPasteEvent({
      'text/html': '<p><strong>bold</strong> text</p>',
      'text/plain': 'bold text',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    // Should paste as plain text, no formatting
    expect(container.querySelector('pre strong')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toContain('bold text');
    editor.destroy();
  });

  it('code block content is sanitized', async () => {
    const editor = createEditor(container);
    cursorToEnd(container);

    const pasteEvent = createPasteEvent({
      'text/html': '<pre><code><script>alert(1)</script>safe code</code></pre>',
    });
    container.dispatchEvent(pasteEvent);

    await flush();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('safe code');
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

  it('exec bold toggles off when selection is inside <strong>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><strong>bold text</strong></p>';
    const strong = container.querySelector('strong')!;
    const range = document.createRange();
    range.selectNodeContents(strong);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('bold');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('bold text');
    editor.destroy();
  });

  it('exec italic toggles off when selection is inside <em>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><em>italic text</em></p>';
    const em = container.querySelector('em')!;
    const range = document.createRange();
    range.selectNodeContents(em);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('italic');
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toContain('italic text');
    editor.destroy();
  });

  it('exec underline toggles off when selection is inside <u>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p><u>underlined text</u></p>';
    const u = container.querySelector('u')!;
    const range = document.createRange();
    range.selectNodeContents(u);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('underline');
    expect(container.querySelector('u')).toBeNull();
    expect(container.textContent).toContain('underlined text');
    editor.destroy();
  });

  it('exec bold with collapsed cursor (no selection) does not modify DOM', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>hello</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 3);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('bold');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.innerHTML).toBe('<p>hello</p>');
    editor.destroy();
  });

  it('exec heading with no value defaults to level 1', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>title</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('heading');
    expect(container.querySelector('h1')).not.toBeNull();
    editor.destroy();
  });

  it('exec unorderedList when cursor in <ol> converts to <ul>', () => {
    const editor = createEditor(container);
    container.innerHTML = '<ol><li>item</li></ol>';
    const li = container.querySelector('li')!;
    const range = document.createRange();
    range.setStart(li.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('unorderedList');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelector('ul li')!.textContent).toBe('item');
    editor.destroy();
  });

  it('exec link with collapsed cursor inserts <a> with URL as text', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>text</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 4);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.exec('link', 'https://example.com');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.textContent).toBe('https://example.com');
    editor.destroy();
  });

  it('exec unlink with no <a> ancestor is a no-op', () => {
    const editor = createEditor(container);
    container.innerHTML = '<p>no link here</p>';
    const p = container.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const before = container.innerHTML;
    editor.exec('unlink');
    expect(container.innerHTML).toBe(before);
    editor.destroy();
  });
});
