import { useEffect, useRef } from 'react';
import { createEditor } from '../editor';
import { sanitizeToFragment } from '../sanitize';
import { DEFAULT_POLICY } from '../defaults';
import type { Editor, SanitizePolicy } from '../types';

export type { Editor, SanitizePolicy } from '../types';

export interface MinisiwygProps {
  initialHTML?: string;
  value?: string;
  onChange?: (html: string) => void;
  policy?: SanitizePolicy;
  className?: string;
  editorRef?: (editor: Editor | null) => void;
}

export function Minisiwyg(props: MinisiwygProps) {
  const { initialHTML, value, onChange, policy, className, editorRef } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorInstance = useRef<Editor | null>(null);
  const onChangeRef = useRef<typeof onChange>(onChange);
  const policyRef = useRef<SanitizePolicy>(policy ?? DEFAULT_POLICY);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const effectivePolicy = policy ?? DEFAULT_POLICY;
    policyRef.current = effectivePolicy;
    el.replaceChildren(sanitizeToFragment(value ?? initialHTML ?? '', effectivePolicy));
    const editor = createEditor(el, {
      policy: effectivePolicy,
      onChange: (html) => onChangeRef.current?.(html),
    });
    editorInstance.current = editor;
    editorRef?.(editor);
    return () => {
      editor.destroy();
      editorInstance.current = null;
      editorRef?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorInstance.current;
    const el = hostRef.current;
    if (!editor || !el || value === undefined) return;
    if (editor.getHTML() !== value) {
      el.replaceChildren(sanitizeToFragment(value, policyRef.current));
    }
  }, [value]);

  return <div ref={hostRef} className={className} />;
}
