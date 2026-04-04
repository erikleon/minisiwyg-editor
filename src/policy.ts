import type { SanitizePolicy } from './types';
import { TAG_NORMALIZE, URL_ATTRS, isProtocolAllowed } from './shared';

export { DEFAULT_POLICY } from './defaults';
export type { SanitizePolicy } from './types';

export interface PolicyEnforcer {
  destroy(): void;
  on(event: 'error', handler: (error: Error) => void): void;
}

/**
 * Get the nesting depth of a node within a root element.
 */
function getDepth(node: Node, root: Node): number {
  let depth = 0;
  let current = node.parentNode;
  while (current && current !== root) {
    if (current.nodeType === 1) depth++;
    current = current.parentNode;
  }
  return depth;
}

/**
 * Check if an element is allowed by the policy and fix it if not.
 * Returns true if the node was removed/replaced.
 */
function enforceElement(
  el: Element,
  policy: SanitizePolicy,
  root: HTMLElement,
): boolean {
  let tagName = el.tagName.toLowerCase();
  const normalized = TAG_NORMALIZE[tagName];
  if (normalized) tagName = normalized;

  // Check depth
  const depth = getDepth(el, root);
  if (depth >= policy.maxDepth) {
    el.parentNode?.removeChild(el);
    return true;
  }

  // Check tag whitelist
  const allowedAttrs = policy.tags[tagName];
  if (allowedAttrs === undefined) {
    if (policy.strip) {
      el.parentNode?.removeChild(el);
    } else {
      // Unwrap: move children up, then remove the element
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      }
    }
    return true;
  }

  // Normalize tag if needed (e.g. <b> → <strong>)
  let current: Element = el;
  if (normalized && el.tagName.toLowerCase() !== normalized) {
    const replacement = el.ownerDocument.createElement(normalized);
    while (el.firstChild) {
      replacement.appendChild(el.firstChild);
    }
    // Copy allowed attributes
    for (const attr of Array.from(el.attributes)) {
      replacement.setAttribute(attr.name, attr.value);
    }
    el.parentNode?.replaceChild(replacement, el);
    current = replacement;
  }

  // Strip disallowed attributes
  for (const attr of Array.from(current.attributes)) {
    const attrName = attr.name.toLowerCase();

    if (attrName.startsWith('on')) {
      current.removeAttribute(attr.name);
      continue;
    }

    if (!allowedAttrs.includes(attrName)) {
      current.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTRS.has(attrName)) {
      if (!isProtocolAllowed(attr.value, policy.protocols)) {
        current.removeAttribute(attr.name);
      }
    }
  }

  return false;
}

/**
 * Recursively enforce policy on all descendants of a node.
 */
function enforceSubtree(node: Node, policy: SanitizePolicy, root: HTMLElement): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType !== 1) {
      // Remove non-text, non-element nodes (comments, etc.)
      if (child.nodeType !== 3) {
        node.removeChild(child);
      }
      continue;
    }
    const removed = enforceElement(child as Element, policy, root);
    if (!removed) {
      enforceSubtree(child, policy, root);
    }
  }
}

/**
 * Create a policy enforcer that uses MutationObserver to enforce
 * the sanitization policy on a live DOM element.
 *
 * This is defense-in-depth — the paste handler is the primary security boundary.
 * The observer catches mutations from execCommand, programmatic DOM manipulation,
 * and other sources.
 */
export function createPolicyEnforcer(
  element: HTMLElement,
  policy: SanitizePolicy,
): PolicyEnforcer {
  if (!policy || !policy.tags) {
    throw new TypeError('Policy must have a "tags" property');
  }

  let isApplyingFix = false;
  const errorHandlers: Array<(error: Error) => void> = [];

  function emitError(error: Error): void {
    for (const handler of errorHandlers) {
      handler(error);
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (isApplyingFix) return;
    isApplyingFix = true;

    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of Array.from(mutation.addedNodes)) {
            // Skip text nodes
            if (node.nodeType === 3) continue;

            // Remove non-element nodes
            if (node.nodeType !== 1) {
              node.parentNode?.removeChild(node);
              continue;
            }

            const removed = enforceElement(node as Element, policy, element);
            if (!removed) {
              // Also enforce on all descendants of the added node
              enforceSubtree(node, policy, element);
            }
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target as Element;
          if (target.nodeType !== 1) continue;

          const attrName = mutation.attributeName;
          if (!attrName) continue;

          const tagName = target.tagName.toLowerCase();
          const normalizedTag = TAG_NORMALIZE[tagName] || tagName;
          const allowedAttrs = policy.tags[normalizedTag];

          if (!allowedAttrs) continue;

          const lowerAttr = attrName.toLowerCase();

          if (lowerAttr.startsWith('on')) {
            target.removeAttribute(attrName);
            continue;
          }

          if (!allowedAttrs.includes(lowerAttr)) {
            target.removeAttribute(attrName);
            continue;
          }

          if (URL_ATTRS.has(lowerAttr)) {
            const value = target.getAttribute(attrName);
            if (value && !isProtocolAllowed(value, policy.protocols)) {
              target.removeAttribute(attrName);
            }
          }
        }
      }
    } catch (err) {
      emitError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isApplyingFix = false;
    }
  });

  observer.observe(element, {
    childList: true,
    attributes: true,
    subtree: true,
  });

  return {
    destroy() {
      observer.disconnect();
    },
    on(event: 'error', handler: (error: Error) => void) {
      if (event === 'error') {
        errorHandlers.push(handler);
      }
    },
  };
}
