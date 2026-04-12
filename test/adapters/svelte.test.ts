import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { minisiwyg } from '../../src/adapters/svelte';
import type { Editor } from '../../src/types';

describe('Svelte adapter', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('initializes the editor with initialHTML', () => {
    let editor: Editor | null = null;
    const action = minisiwyg(host, {
      initialHTML: '<p>hi</p>',
      onReady: (e) => (editor = e),
    });
    expect(host.innerHTML).toContain('hi');
    expect(host.contentEditable).toBe('true');
    expect(editor).toBeTruthy();
    action.destroy();
  });

  it('fires onChange on input', () => {
    const onChange = vi.fn();
    const action = minisiwyg(host, { initialHTML: '<p>a</p>', onChange });
    host.innerHTML = '<p>b</p>';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    action.destroy();
  });

  it('reconciles value updates without feedback loops', () => {
    const action = minisiwyg(host, { value: '<p>one</p>' });
    expect(host.innerHTML).toContain('one');
    action.update({ value: '<p>two</p>' });
    expect(host.innerHTML).toContain('two');
    action.destroy();
  });

  it('sanitizes initialHTML before it reaches the live DOM', () => {
    const action = minisiwyg(host, {
      initialHTML: '<p>ok</p><script>bad()</script>',
    });
    expect(host.innerHTML).not.toContain('<script>');
    expect(host.innerHTML).toContain('ok');
    action.destroy();
  });

  it('sanitizes controlled value updates', () => {
    const action = minisiwyg(host, { value: '<p>one</p>' });
    action.update({ value: '<p>two</p><iframe src="x"></iframe>' });
    expect(host.innerHTML).not.toContain('<iframe');
    expect(host.innerHTML).toContain('two');
    action.destroy();
  });

  it('update() rewires onChange without stale closures', () => {
    const first = vi.fn();
    const second = vi.fn();
    const action = minisiwyg(host, { initialHTML: '<p>hi</p>', onChange: first });
    action.update({ onChange: second });
    host.innerHTML = '<p>changed</p>';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    action.destroy();
  });

  it('destroys the editor', () => {
    const action = minisiwyg(host, { initialHTML: '<p>hi</p>' });
    expect(host.contentEditable).toBe('true');
    action.destroy();
    expect(host.contentEditable).toBe('false');
  });
});
