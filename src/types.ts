/**
 * Declarative sanitization policy.
 * JSON-serializable so policies can be stored, transmitted, and validated.
 */
export interface SanitizePolicy {
  /** Allowed tags mapped to their allowed attributes. */
  tags: Record<string, string[]>;
  /** When true, disallowed nodes are removed entirely. When false, they are unwrapped (text kept). */
  strip: boolean;
  /** Maximum nesting depth. Nodes deeper than this are removed. */
  maxDepth: number;
  /** Maximum textContent length. Content beyond this is truncated. */
  maxLength: number;
  /** Allowed URL protocols for href, src, action attributes. */
  protocols: string[];
}

export interface EditorOptions {
  policy?: SanitizePolicy;
  plugins?: Plugin[];
  onChange?: (html: string) => void;
}

export interface Editor {
  exec(command: string, value?: string): void;
  queryState(command: string): boolean;
  getHTML(): string;
  getText(): string;
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  readonly element: HTMLElement;
}

export interface ToolbarOptions {
  actions?: string[];
  element?: HTMLElement;
  plugins?: Plugin[];
}

export interface PluginContext {
  readonly element: HTMLElement;
  readonly doc: Document;
  /** Frozen after registration — plugins cannot widen the policy at runtime. */
  readonly policy: SanitizePolicy;
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/** Returned from `setup` to undo whatever it attached. Run by `destroy()`. */
export type PluginTeardown = () => void;

export interface PluginCommand {
  exec(ctx: PluginContext, value?: string): void;
  queryState?(ctx: PluginContext): boolean;
}

export interface PluginAction {
  label: string;
  icon?: string;
}

export interface PluginPolicyDelta {
  tags?: Record<string, string[]>;
  protocols?: string[];
}

export interface Plugin {
  name: string;
  policy?: PluginPolicyDelta;
  commands?: Record<string, PluginCommand>;
  actions?: Record<string, PluginAction>;
  /** Runs once at `createEditor`. Return a teardown and `destroy()` will call it. */
  setup?(ctx: PluginContext): PluginTeardown | void;
  /** Return true to mark the key handled and skip the built-in handling. */
  onKeydown?(ctx: PluginContext, event: KeyboardEvent): boolean | void;
  /** Return true to mark the input handled and let nothing else act on it. */
  onBeforeInput?(ctx: PluginContext, event: InputEvent): boolean | void;
  /**
   * Runs after the paste has been sanitized, so `fragment` is already policy-clean.
   * Return true to take over insertion entirely.
   */
  onPaste?(
    ctx: PluginContext,
    event: ClipboardEvent,
    fragment: DocumentFragment,
  ): boolean | void;
}

export interface Toolbar {
  /** The toolbar container element. Place this in the DOM. */
  element: HTMLElement;
  destroy(): void;
}
