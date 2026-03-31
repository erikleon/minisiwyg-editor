import type { SanitizePolicy } from './types';
export { DEFAULT_POLICY } from './defaults';
export type { SanitizePolicy } from './types';

/** Tag normalization map: browser-variant tags → semantic equivalents. */
const TAG_NORMALIZE: Record<string, string> = {
  b: 'strong',
  i: 'em',
};

/** Attributes that contain URLs and need protocol validation. */
const URL_ATTRS = new Set(['href', 'src', 'action']);

/** Protocols that are always denied regardless of policy. */
const DENIED_PROTOCOLS = new Set(['javascript', 'data']);

/**
 * Parse a URL-like string and extract the protocol.
 * Returns the lowercase protocol name (without colon), or null if none found.
 */
function extractProtocol(value: string): string | null {
  const trimmed = value.trim();
  // Match protocol at start: "http:", "javascript:", etc.
  // Handle HTML entity encoding and URL encoding by decoding first.
  let decoded = trimmed;
  // Decode HTML entities: &#x6A; → j, &#106; → j, etc.
  decoded = decoded.replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  decoded = decoded.replace(/&#(\d+);?/g, (_, dec) =>
    String.fromCharCode(parseInt(dec, 10)),
  );
  // Decode URL encoding: %6A → j
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // If URL decoding fails, keep entity-decoded result
  }
  // Strip whitespace and control characters that browsers ignore
  decoded = decoded.replace(/[\s\x00-\x1f]+/g, '');
  const match = decoded.match(/^([a-z][a-z0-9+\-.]*)\s*:/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if a URL value is allowed by the given protocol list.
 * javascript: and data: are always denied.
 */
function isProtocolAllowed(value: string, allowedProtocols: string[]): boolean {
  const protocol = extractProtocol(value);
  if (protocol === null) {
    // Relative URLs, fragment-only (#), etc. are allowed
    return true;
  }
  if (DENIED_PROTOCOLS.has(protocol)) {
    return false;
  }
  return allowedProtocols.includes(protocol);
}

/**
 * Walk a DOM tree depth-first and sanitize according to policy.
 * Mutates the tree in place.
 */
function walkAndSanitize(
  parent: Node,
  policy: SanitizePolicy,
  depth: number,
): void {
  const children = Array.from(parent.childNodes);

  for (const node of children) {
    // Text nodes: always allowed (length enforcement happens after walk)
    if (node.nodeType === 3) continue;

    // Non-element, non-text nodes (comments, processing instructions): remove
    if (node.nodeType !== 1) {
      parent.removeChild(node);
      continue;
    }

    const el = node as Element;
    let tagName = el.tagName.toLowerCase();

    // Normalize tags (b→strong, i→em)
    const normalized = TAG_NORMALIZE[tagName];
    if (normalized) {
      tagName = normalized;
    }

    // Check depth limit
    if (depth >= policy.maxDepth) {
      parent.removeChild(el);
      continue;
    }

    // Check tag whitelist
    const allowedAttrs = policy.tags[tagName];
    if (allowedAttrs === undefined) {
      // Tag not allowed
      if (policy.strip) {
        // Remove the node and all its children
        parent.removeChild(el);
      } else {
        // Unwrap: sanitize children first, then move them up
        walkAndSanitize(el, policy, depth);
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      }
      continue;
    }

    // Tag is allowed. If it was normalized, replace with correct element.
    let current: Element = el;
    if (normalized && el.tagName.toLowerCase() !== normalized) {
      const doc = el.ownerDocument!;
      const replacement = doc.createElement(normalized);
      while (el.firstChild) {
        replacement.appendChild(el.firstChild);
      }
      parent.replaceChild(replacement, el);
      current = replacement;
    }

    // Strip disallowed attributes
    const attrs = Array.from(current.attributes);
    for (const attr of attrs) {
      const attrName = attr.name.toLowerCase();

      // Always strip event handlers (on*)
      if (attrName.startsWith('on')) {
        current.removeAttribute(attr.name);
        continue;
      }

      // Check attribute whitelist
      if (!allowedAttrs.includes(attrName)) {
        current.removeAttribute(attr.name);
        continue;
      }

      // Validate URL protocols on URL-bearing attributes
      if (URL_ATTRS.has(attrName)) {
        if (!isProtocolAllowed(attr.value, policy.protocols)) {
          current.removeAttribute(attr.name);
        }
      }
    }

    // Recurse into children
    walkAndSanitize(current, policy, depth + 1);
  }
}

/**
 * Sanitize an HTML string according to the given policy.
 *
 * Uses a <template> element to parse HTML without executing scripts.
 * Walks the resulting DOM tree depth-first, removing disallowed elements
 * and attributes. Returns the sanitized HTML string.
 */
export function sanitize(html: string, policy: SanitizePolicy): string {
  if (!html) return '';

  // Parse via <template> — no script execution
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;

  // Walk and sanitize the DOM tree
  walkAndSanitize(fragment, policy, 0);

  // Enforce maxLength on textContent
  const container = document.createElement('div');
  container.appendChild(fragment);

  if (policy.maxLength > 0 && (container.textContent?.length ?? 0) > policy.maxLength) {
    truncateToLength(container, policy.maxLength);
  }

  return container.innerHTML;
}

/**
 * Truncate a DOM tree's text content to a maximum length.
 * Removes nodes beyond the limit while preserving structure.
 */
function truncateToLength(node: Node, maxLength: number): number {
  let remaining = maxLength;

  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (remaining <= 0) {
      node.removeChild(child);
      continue;
    }

    if (child.nodeType === 3) {
      // Text node
      const text = child.textContent ?? '';
      if (text.length > remaining) {
        child.textContent = text.slice(0, remaining);
        remaining = 0;
      } else {
        remaining -= text.length;
      }
    } else if (child.nodeType === 1) {
      remaining = truncateToLength(child, remaining);
    } else {
      node.removeChild(child);
    }
  }

  return remaining;
}
