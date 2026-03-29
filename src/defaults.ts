import type { SanitizePolicy } from './types';

const policy: SanitizePolicy = {
  tags: {
    p: [],
    br: [],
    strong: [],
    em: [],
    a: ['href', 'title', 'target'],
    h1: [],
    h2: [],
    h3: [],
    ul: [],
    ol: [],
    li: [],
    blockquote: [],
    pre: [],
    code: [],
  },
  strip: true,
  maxDepth: 10,
  maxLength: 100_000,
  protocols: ['https', 'http', 'mailto'],
};

// Deep freeze to prevent mutation of security-critical defaults
Object.freeze(policy);
Object.freeze(policy.protocols);
for (const attrs of Object.values(policy.tags)) Object.freeze(attrs);
Object.freeze(policy.tags);

export const DEFAULT_POLICY: Readonly<SanitizePolicy> = policy;
