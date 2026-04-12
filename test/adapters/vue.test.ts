import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp, type App } from 'vue';
import { Minisiwyg } from '../../src/adapters/vue';
import type { Editor } from '../../src/types';

describe('Vue adapter', () => {
  let host: HTMLElement;
  let app: App | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    host.remove();
  });

  it('mounts and creates an editor', async () => {
    let editor: Editor | null = null;
    app = createApp(Minisiwyg, {
      initialHTML: '<p>hi</p>',
      onReady: (e: Editor) => (editor = e),
    });
    app.mount(host);
    await Promise.resolve();
    const el = host.querySelector('div[contenteditable="true"]');
    expect(el).toBeTruthy();
    expect(el?.innerHTML).toContain('hi');
    expect(editor).toBeTruthy();
  });

  it('emits change event on input', async () => {
    const onChange = vi.fn();
    app = createApp(Minisiwyg, {
      initialHTML: '<p>hi</p>',
      onChange,
    });
    app.mount(host);
    await Promise.resolve();
    const el = host.querySelector('div[contenteditable="true"]') as HTMLElement;
    el.innerHTML = '<p>changed</p>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });

  it('sanitizes initialHTML before it reaches the live DOM', async () => {
    app = createApp(Minisiwyg, {
      initialHTML: '<p>ok</p><script>bad()</script>',
    });
    app.mount(host);
    await Promise.resolve();
    const el = host.querySelector('div[contenteditable="true"]') as HTMLElement;
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).toContain('ok');
  });

  it('destroys the editor on unmount', async () => {
    app = createApp(Minisiwyg, { initialHTML: '<p>hi</p>' });
    app.mount(host);
    await Promise.resolve();
    const el = host.querySelector('div[contenteditable="true"]') as HTMLElement;
    expect(el.contentEditable).toBe('true');
    app.unmount();
    app = null;
    expect(el.contentEditable).toBe('false');
  });
});
