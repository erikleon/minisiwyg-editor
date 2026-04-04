import type { SanitizePolicy } from './types';
import { TAG_NORMALIZE, URL_ATTRS, isProtocolAllowed } from './shared';
export { DEFAULT_POLICY } from './defaults';
export type { SanitizePolicy } from './types';

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
