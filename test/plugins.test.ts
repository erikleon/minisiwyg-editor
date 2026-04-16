import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEditor } from '../src/editor';
import { createToolbar } from '../src/toolbar';
import { sanitize } from '../src/sanitize';
import { DEFAULT_POLICY } from '../src/defaults';
import type { Plugin, SanitizePolicy } from '../src/types';

function mergedPolicy(): SanitizePolicy {
  return {
    tags: { ...DEFAULT_POLICY.tags, mark: [] },
    strip: DEFAULT_POLICY.strip,
    maxDepth: DEFAULT_POLICY.maxDepth,
    maxLength: DEFAULT_POLICY.maxLength,
    protocols: [...DEFAULT_POLICY.protocols],
  };
}

function highlightPlugin(): Plugin {
  return {
    name: 'highlight',
    policy: { tags: { mark: [] } },
    commands: {
      highlight: {
        exec(ctx) {
          const sel = ctx.doc.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          const mark = ctx.doc.createElement('mark');
          mark.appendChild(range.extractContents());
          range.insertNode(mark);
          ctx.emit('change');
        },
        queryState(ctx) {
          const sel = ctx.doc.getSelection();
          const node = sel?.anchorNode;
          if (!node) return false;
          let cur: Node | null = node;
          while (cur && cur !== ctx.element) {
            if (
              cur.nodeType === 1 &&
              (cur as Element).tagName === 'MARK'
            )
              return true;
            cur = cur.parentNode;
          }
          return false;
        },
      },
    },
    actions: {
      highlight: {
        label: 'Highlight',
        icon: '<path d="M0 0h20v20H0z"/>',
      },
    },
  };
}

describe('plugin system', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="editor"></div>';
    root = document.getElementById('editor') as HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exec runs plugin command and emits change', () => {
    const editor = createEditor(root, { plugins: [highlightPlugin()] });
    root.innerHTML = '<p>hello</p>';
    const onChange = vi.fn();
    editor.on('change', onChange);

    const p = root.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    editor.exec('highlight');
    expect(root.querySelector('mark')).not.toBeNull();
    expect(onChange).toHaveBeenCalled();
    editor.destroy();
  });

  it('queryState reports true inside plugin-registered node', () => {
    const editor = createEditor(root, { plugins: [highlightPlugin()] });
    root.innerHTML = '<p><mark>x</mark></p>';

    const mark = root.querySelector('mark')!;
    const range = document.createRange();
    range.selectNodeContents(mark);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(editor.queryState('highlight')).toBe(true);
    editor.destroy();
  });

  it('built-in commands still work alongside plugins', () => {
    const editor = createEditor(root, { plugins: [highlightPlugin()] });
    expect(() => editor.queryState('bold')).not.toThrow();
    expect(editor.queryState('bold')).toBe(false);
    editor.destroy();
  });

  it('throws on duplicate command name across plugins', () => {
    const a = highlightPlugin();
    const b = highlightPlugin();
    b.name = 'highlight2';
    expect(() =>
      createEditor(root, { plugins: [a, b] }),
    ).toThrow(/duplicates command 'highlight'/);
  });

  it('throws when plugin policy tag key has uppercase letters', () => {
    const p: Plugin = {
      name: 'shouty',
      policy: { tags: { MARK: [] } },
    };
    expect(() => createEditor(root, { plugins: [p] })).toThrow(
      /tag 'MARK' must be lowercase/,
    );
  });

  it('throws when plugin command collides with built-in', () => {
    const p: Plugin = {
      name: 'shadow',
      commands: {
        bold: { exec() {} },
      },
    };
    expect(() => createEditor(root, { plugins: [p] })).toThrow(
      /duplicates command 'bold'/,
    );
  });

  it('policy delta merges: mark is preserved after plugin registration', () => {
    expect(sanitize('<mark>x</mark>', DEFAULT_POLICY)).not.toContain('<mark>');
    expect(sanitize('<mark>x</mark>', mergedPolicy())).toBe('<mark>x</mark>');
  });

  it('toolbar renders a button for plugin action', () => {
    const editor = createEditor(root, { plugins: [highlightPlugin()] });
    const toolbar = createToolbar(editor, { plugins: [highlightPlugin()] });
    const btn = toolbar.element.querySelector(
      '.minisiwyg-btn-highlight',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Highlight');
    toolbar.destroy();
    editor.destroy();
  });

  it('toolbar click invokes plugin command via editor', () => {
    const plugin = highlightPlugin();
    const editor = createEditor(root, { plugins: [plugin] });
    const toolbar = createToolbar(editor, {
      plugins: [plugin],
      actions: ['highlight'],
    });
    document.body.appendChild(toolbar.element);

    root.innerHTML = '<p>abc</p>';
    const p = root.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const btn = toolbar.element.querySelector(
      '.minisiwyg-btn-highlight',
    ) as HTMLButtonElement;
    btn.click();

    expect(root.querySelector('mark')).not.toBeNull();
    toolbar.destroy();
    editor.destroy();
  });

  it('plugin action id is used as the editor command name', () => {
    const execSpy = vi.fn();
    const plugin: Plugin = {
      name: 'custom',
      commands: {
        openDialog: { exec: execSpy },
      },
      actions: {
        openDialog: { label: 'Open dialog' },
      },
    };
    const editor = createEditor(root, { plugins: [plugin] });
    const toolbar = createToolbar(editor, {
      plugins: [plugin],
      actions: ['openDialog'],
    });
    const btn = toolbar.element.querySelector(
      '.minisiwyg-btn-openDialog',
    ) as HTMLButtonElement;
    btn.click();
    expect(execSpy).toHaveBeenCalled();
    toolbar.destroy();
    editor.destroy();
  });

  it('protocols delta unions with policy protocols', () => {
    const plugin: Plugin = {
      name: 'tel',
      policy: { protocols: ['tel'] },
    };
    const seen: SanitizePolicy[] = [];
    const captor: Plugin = {
      name: 'captor',
      commands: {
        capture: {
          exec(ctx) {
            seen.push(ctx.policy);
          },
        },
      },
    };
    const editor = createEditor(root, { plugins: [plugin, captor] });
    editor.exec('capture');
    expect(seen[0].protocols).toContain('tel');
    expect(seen[0].protocols).toContain('https');
    editor.destroy();
  });
});
