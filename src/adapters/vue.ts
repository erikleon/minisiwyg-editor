import {
  defineComponent,
  h,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  type PropType,
} from 'vue';
import { createEditor } from '../editor';
import { sanitizeToFragment } from '../sanitize';
import { DEFAULT_POLICY } from '../defaults';
import type { Editor, SanitizePolicy } from '../types';

export type { Editor, SanitizePolicy } from '../types';

export const Minisiwyg = defineComponent({
  name: 'Minisiwyg',
  props: {
    initialHTML: { type: String, default: undefined },
    value: { type: String, default: undefined },
    policy: { type: Object as PropType<SanitizePolicy>, default: undefined },
    class: { type: String, default: undefined },
  },
  emits: {
    change: (_html: string) => true,
    ready: (_editor: Editor) => true,
  },
  setup(props, { emit }) {
    const hostRef = ref<HTMLDivElement | null>(null);
    let editor: Editor | null = null;
    let effectivePolicy: SanitizePolicy = props.policy ?? DEFAULT_POLICY;

    onMounted(() => {
      const el = hostRef.value;
      if (!el) return;
      effectivePolicy = props.policy ?? DEFAULT_POLICY;
      el.replaceChildren(
        sanitizeToFragment(props.value ?? props.initialHTML ?? '', effectivePolicy),
      );
      editor = createEditor(el, {
        policy: effectivePolicy,
        onChange: (html) => emit('change', html),
      });
      emit('ready', editor);
    });

    onBeforeUnmount(() => {
      editor?.destroy();
      editor = null;
    });

    watch(
      () => props.value,
      (next) => {
        const el = hostRef.value;
        if (!editor || !el || next === undefined) return;
        if (editor.getHTML() !== next) {
          el.replaceChildren(sanitizeToFragment(next, effectivePolicy));
        }
      },
    );

    return () => h('div', { ref: hostRef, class: props.class });
  },
});
