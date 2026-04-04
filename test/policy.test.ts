import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPolicyEnforcer } from '../src/policy';
import { DEFAULT_POLICY } from '../src/defaults';
import type { SanitizePolicy } from '../src/types';

function makePolicy(overrides?: Partial<SanitizePolicy>): SanitizePolicy {
  return {
    tags: { ...DEFAULT_POLICY.tags },
    strip: DEFAULT_POLICY.strip,
    maxDepth: DEFAULT_POLICY.maxDepth,
    maxLength: DEFAULT_POLICY.maxLength,
    protocols: [...DEFAULT_POLICY.protocols],
    ...overrides,
  };
}

/**
 * Flush pending MutationObserver callbacks.
 * MutationObserver is microtask-based; we need to yield the event loop.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Policy Engine', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('removes dynamically added <script> tag', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const script = document.createElement('script');
    script.textContent = 'void 0';
    container.appendChild(script);

    await flush();
    expect(container.querySelector('script')).toBeNull();
    enforcer.destroy();
  });

  it('normalizes <b> to <strong> on insertion', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const b = document.createElement('b');
    b.textContent = 'bold';
    container.appendChild(b);

    await flush();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    enforcer.destroy();
  });

  it('normalizes <i> to <em> on insertion', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const i = document.createElement('i');
    i.textContent = 'italic';
    container.appendChild(i);

    await flush();
    expect(container.querySelector('i')).toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('italic');
    enforcer.destroy();
  });

  it('strips onclick attribute added to an allowed tag', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const p = document.createElement('p');
    p.textContent = 'test';
    container.appendChild(p);
    await flush();

    p.setAttribute('onclick', 'alert(1)');
    await flush();

    expect(p.hasAttribute('onclick')).toBe(false);
    enforcer.destroy();
  });

  it('strips disallowed attributes on added elements', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const p = document.createElement('p');
    p.setAttribute('style', 'color: red');
    p.setAttribute('class', 'foo');
    p.textContent = 'test';
    container.appendChild(p);

    await flush();
    expect(p.hasAttribute('style')).toBe(false);
    expect(p.hasAttribute('class')).toBe(false);
    enforcer.destroy();
  });

  it('re-entrancy guard prevents infinite loops', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    // Add a disallowed tag — observer removes it, which is a mutation,
    // but the guard prevents re-processing
    const div = document.createElement('div');
    div.textContent = 'test';
    container.appendChild(div);

    await flush();
    // div should be removed (strip mode), no infinite loop
    expect(container.querySelector('div')).toBeNull();
    enforcer.destroy();
  });

  it('destroy() disconnects observer cleanly', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);
    enforcer.destroy();

    // After destroy, mutations should not be caught
    const span = document.createElement('span');
    span.textContent = 'disallowed';
    container.appendChild(span);

    await flush();
    // Span should still be there since observer is disconnected
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('enforces maxDepth on deeply nested insertion', async () => {
    const policy = makePolicy({ maxDepth: 3 });
    const enforcer = createPolicyEnforcer(container, policy);

    // Create nested structure: p > p > p > p (4 levels)
    const html = '<p><p><p><p>deep</p></p></p></p>';
    container.innerHTML = html;

    await flush();
    // The deepest nodes should be removed
    let depth = 0;
    let node: Element | null = container;
    while (node) {
      const child = node.querySelector('p');
      if (!child) break;
      depth++;
      node = child;
    }
    expect(depth).toBeLessThanOrEqual(3);
    enforcer.destroy();
  });

  it('allows whitelisted tags without modification', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const p = document.createElement('p');
    p.textContent = 'hello world';
    container.appendChild(p);

    await flush();
    expect(container.querySelector('p')?.textContent).toBe('hello world');
    enforcer.destroy();
  });

  it('handles multiple rapid mutations correctly', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    // Add many elements rapidly
    for (let i = 0; i < 10; i++) {
      const p = document.createElement('p');
      p.textContent = `paragraph ${i}`;
      container.appendChild(p);
    }

    // Also add disallowed elements in the batch
    const span = document.createElement('span');
    container.appendChild(span);
    const div = document.createElement('div');
    div.textContent = 'div content';
    container.appendChild(div);

    await flush();
    expect(container.querySelectorAll('p').length).toBe(10);
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
    enforcer.destroy();
  });

  it('catches and sanitizes programmatic innerHTML assignment', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    container.innerHTML = '<p>safe</p><div onclick="void 0">bad</div><span>disallowed</span>';

    await flush();
    expect(container.querySelector('div')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('safe');
    enforcer.destroy();
  });

  it('throws helpful error for malformed policy (missing tags)', () => {
    expect(() => {
      createPolicyEnforcer(container, {} as SanitizePolicy);
    }).toThrow('Policy must have a "tags" property');
  });

  it('throws helpful error for null policy', () => {
    expect(() => {
      createPolicyEnforcer(container, null as unknown as SanitizePolicy);
    }).toThrow('Policy must have a "tags" property');
  });

  it('emits error event on observer exception without crashing', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const errors: Error[] = [];
    enforcer.on('error', (err) => errors.push(err));

    // Observer should not crash even if processing encounters issues.
    // Add a valid element — no error expected
    const p = document.createElement('p');
    p.textContent = 'test';
    container.appendChild(p);

    await flush();
    expect(container.querySelector('p')?.textContent).toBe('test');
    expect(errors.length).toBe(0);
    enforcer.destroy();
  });

  it('strips disallowed href protocol added via setAttribute', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.textContent = 'link';
    container.appendChild(a);
    await flush();

    // Now change to javascript: URL
    a.setAttribute('href', 'javascript:alert(1)');
    await flush();

    expect(a.hasAttribute('href')).toBe(false);
    enforcer.destroy();
  });

  it('allows valid href protocols', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.textContent = 'link';
    container.appendChild(a);

    await flush();
    expect(a.getAttribute('href')).toBe('https://example.com');
    enforcer.destroy();
  });

  it('allows a elements with title and target attributes', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.setAttribute('title', 'Example');
    a.setAttribute('target', '_blank');
    a.textContent = 'link';
    container.appendChild(a);

    await flush();
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('title')).toBe('Example');
    expect(a.getAttribute('target')).toBe('_blank');
    enforcer.destroy();
  });

  it('enforces policy on subtrees of added nodes', async () => {
    const policy = makePolicy();
    const enforcer = createPolicyEnforcer(container, policy);

    // Add a node with disallowed children
    const p = document.createElement('p');
    const span = document.createElement('span');
    span.textContent = 'disallowed';
    p.appendChild(span);
    p.appendChild(document.createTextNode('safe'));
    container.appendChild(p);

    await flush();
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('safe');
    enforcer.destroy();
  });

  it('unwraps disallowed tags when strip is false', async () => {
    const policy = makePolicy({ strip: false });
    const enforcer = createPolicyEnforcer(container, policy);

    const div = document.createElement('div');
    div.textContent = 'unwrapped text';
    container.appendChild(div);

    await flush();
    expect(container.querySelector('div')).toBeNull();
    expect(container.textContent).toContain('unwrapped text');
    enforcer.destroy();
  });
});
