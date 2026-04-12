import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { Minisiwyg } from '../../src/adapters/react';
import type { Editor } from '../../src/types';

describe('React adapter', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('mounts and creates an editor', () => {
    let editor: Editor | null = null;
    act(() => {
      root.render(
        <Minisiwyg initialHTML="<p>hi</p>" editorRef={(e) => (editor = e)} />,
      );
    });
    const host = container.querySelector('div[contenteditable="true"]');
    expect(host).toBeTruthy();
    expect(host?.innerHTML).toContain('hi');
    expect(editor).toBeTruthy();
  });

  it('fires onChange when input event fires', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<Minisiwyg initialHTML="<p>hi</p>" onChange={onChange} />);
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    host.innerHTML = '<p>hi there</p>';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });

  it('reconciles controlled value without fighting equal state', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <Minisiwyg value="<p>one</p>" onChange={onChange} />,
      );
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    expect(host.innerHTML).toContain('one');
    act(() => {
      root.render(
        <Minisiwyg value="<p>two</p>" onChange={onChange} />,
      );
    });
    expect(host.innerHTML).toContain('two');
  });

  it('sanitizes initialHTML before it reaches the live DOM', () => {
    act(() => {
      root.render(<Minisiwyg initialHTML='<p>ok</p><script>bad()</script>' />);
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    expect(host.innerHTML).not.toContain('<script>');
    expect(host.innerHTML).toContain('ok');
  });

  it('sanitizes controlled value updates', () => {
    act(() => {
      root.render(<Minisiwyg value="<p>one</p>" />);
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    act(() => {
      root.render(<Minisiwyg value='<p>two</p><iframe src="x"></iframe>' />);
    });
    expect(host.innerHTML).not.toContain('<iframe');
    expect(host.innerHTML).toContain('two');
  });

  it('tracks latest onChange via ref (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      root.render(<Minisiwyg initialHTML="<p>hi</p>" onChange={first} />);
    });
    act(() => {
      root.render(<Minisiwyg initialHTML="<p>hi</p>" onChange={second} />);
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    host.innerHTML = '<p>changed</p>';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('destroys the editor on unmount', () => {
    let editor: Editor | null = null;
    act(() => {
      root.render(<Minisiwyg editorRef={(e) => (editor = e)} />);
    });
    const host = container.querySelector('div[contenteditable="true"]') as HTMLElement;
    expect(host.contentEditable).toBe('true');
    act(() => root.unmount());
    expect(host.contentEditable).toBe('false');
    expect(editor).toBeNull();
  });
});
