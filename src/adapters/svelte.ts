import { createEditor } from '../editor';
import { sanitizeToFragment } from '../sanitize';
import { DEFAULT_POLICY } from '../defaults';
import type { Editor, SanitizePolicy } from '../types';

export type { Editor, SanitizePolicy } from '../types';

export interface MinisiwygParams {
  initialHTML?: string;
  value?: string;
  policy?: SanitizePolicy;
  onChange?: (html: string) => void;
  onReady?: (editor: Editor) => void;
}

export interface MinisiwygAction {
  update(params: MinisiwygParams): void;
  destroy(): void;
}

export function minisiwyg(
  node: HTMLElement,
  params: MinisiwygParams = {},
): MinisiwygAction {
  const effectivePolicy: SanitizePolicy = params.policy ?? DEFAULT_POLICY;
  let onChange = params.onChange;

  node.replaceChildren(
    sanitizeToFragment(params.value ?? params.initialHTML ?? '', effectivePolicy),
  );
  const editor = createEditor(node, {
    policy: effectivePolicy,
    onChange: (html) => onChange?.(html),
  });
  params.onReady?.(editor);

  return {
    update(next: MinisiwygParams) {
      onChange = next.onChange;
      if (next.value !== undefined && editor.getHTML() !== next.value) {
        node.replaceChildren(sanitizeToFragment(next.value, effectivePolicy));
      }
    },
    destroy() {
      editor.destroy();
    },
  };
}
