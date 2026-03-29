import { describe, it, expect } from 'vitest';
import { DEFAULT_POLICY } from '../src/index';

describe('mini-editor', () => {
  it('exports DEFAULT_POLICY', () => {
    expect(DEFAULT_POLICY).toBeDefined();
    expect(DEFAULT_POLICY.strip).toBe(true);
    expect(DEFAULT_POLICY.tags).toHaveProperty('strong');
    expect(DEFAULT_POLICY.tags).toHaveProperty('em');
    expect(DEFAULT_POLICY.tags).toHaveProperty('a');
  });

  it('DEFAULT_POLICY allows safe protocols only', () => {
    expect(DEFAULT_POLICY.protocols).toContain('https');
    expect(DEFAULT_POLICY.protocols).toContain('http');
    expect(DEFAULT_POLICY.protocols).toContain('mailto');
    expect(DEFAULT_POLICY.protocols).not.toContain('javascript');
    expect(DEFAULT_POLICY.protocols).not.toContain('data');
  });

  it('DEFAULT_POLICY has sensible limits', () => {
    expect(DEFAULT_POLICY.maxDepth).toBeGreaterThan(0);
    expect(DEFAULT_POLICY.maxLength).toBeGreaterThan(0);
  });
});
