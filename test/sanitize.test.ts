import { describe, it, expect } from 'vitest';
import { sanitize } from '../src/sanitize';
import { DEFAULT_POLICY } from '../src/defaults';
import type { SanitizePolicy } from '../src/types';
import { XSS_VECTORS, DANGEROUS_PATTERNS } from './xss-vectors';

/** Helper to create a custom policy. */
function makePolicy(overrides: Partial<SanitizePolicy> = {}): SanitizePolicy {
  return {
    tags: { p: [], strong: [], em: [], a: ['href', 'title', 'target'] },
    strip: true,
    maxDepth: 10,
    maxLength: 100_000,
    protocols: ['https', 'http', 'mailto'],
    ...overrides,
  };
}

describe('sanitize', () => {
  describe('basic behavior', () => {
    it('returns empty string for empty input', () => {
      expect(sanitize('', DEFAULT_POLICY)).toBe('');
    });

    it('returns empty string for null/undefined input', () => {
      expect(sanitize(null as unknown as string, DEFAULT_POLICY)).toBe('');
      expect(sanitize(undefined as unknown as string, DEFAULT_POLICY)).toBe('');
    });

    it('passes through plain text', () => {
      expect(sanitize('hello world', DEFAULT_POLICY)).toBe('hello world');
    });

    it('passes through allowed tags unchanged', () => {
      const html = '<p>Hello <strong>world</strong></p>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('preserves nested allowed tags', () => {
      const html = '<ul><li><strong>item</strong></li></ul>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('preserves allowed attributes on tags', () => {
      const html = '<a href="https://example.com" title="link">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });
  });

  describe('stripping disallowed tags', () => {
    it('strips disallowed tags (strip mode)', () => {
      const policy = makePolicy({ strip: true });
      expect(sanitize('<div>text</div>', policy)).toBe('');
    });

    it('unwraps disallowed tags (unwrap mode)', () => {
      const policy = makePolicy({ strip: false });
      expect(sanitize('<div>text</div>', policy)).toBe('text');
    });

    it('strips script tags', () => {
      expect(sanitize('<script>alert(1)</script>', DEFAULT_POLICY)).toBe('');
    });

    it('strips iframe tags', () => {
      expect(sanitize('<iframe src="evil.html"></iframe>', DEFAULT_POLICY)).toBe('');
    });

    it('strips style tags', () => {
      expect(sanitize('<style>body{color:red}</style>', DEFAULT_POLICY)).toBe('');
    });

    it('unwraps span in unwrap mode preserving text', () => {
      const policy = makePolicy({ strip: false });
      const result = sanitize('<p><span>hello</span> world</p>', policy);
      expect(result).toBe('<p>hello world</p>');
    });
  });

  describe('attribute filtering', () => {
    it('removes disallowed attributes', () => {
      const html = '<a href="https://example.com" class="link" id="x">click</a>';
      const result = sanitize(html, DEFAULT_POLICY);
      expect(result).toBe('<a href="https://example.com">click</a>');
    });

    it('always strips event handler attributes (on*)', () => {
      const html = '<p onclick="alert(1)">text</p>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<p>text</p>');
    });

    it('strips onmouseover, onerror, onfocus', () => {
      const html = '<p onmouseover="x" onerror="y" onfocus="z">text</p>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<p>text</p>');
    });

    it('strips style attribute', () => {
      const html = '<p style="color:red">text</p>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<p>text</p>');
    });
  });

  describe('tag normalization', () => {
    it('normalizes <b> to <strong>', () => {
      expect(sanitize('<b>bold</b>', DEFAULT_POLICY)).toBe('<strong>bold</strong>');
    });

    it('normalizes <i> to <em>', () => {
      expect(sanitize('<i>italic</i>', DEFAULT_POLICY)).toBe('<em>italic</em>');
    });

    it('normalizes nested b and i', () => {
      const result = sanitize('<b><i>both</i></b>', DEFAULT_POLICY);
      expect(result).toBe('<strong><em>both</em></strong>');
    });
  });

  describe('URL protocol validation', () => {
    it('allows https URLs', () => {
      const html = '<a href="https://example.com">link</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('allows http URLs', () => {
      const html = '<a href="http://example.com">link</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('allows mailto URLs', () => {
      const html = '<a href="mailto:test@example.com">email</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('blocks javascript: URLs', () => {
      const html = '<a href="javascript:alert(1)">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('blocks data: URLs', () => {
      const html = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('blocks javascript: even if policy protocols includes it', () => {
      const policy = makePolicy({ protocols: ['https', 'javascript'] });
      const html = '<a href="javascript:alert(1)">click</a>';
      expect(sanitize(html, policy)).toBe('<a>click</a>');
    });

    it('blocks data: even if policy protocols includes it', () => {
      const policy = makePolicy({ protocols: ['https', 'data'] });
      const html = '<a href="data:text/html,evil">click</a>';
      expect(sanitize(html, policy)).toBe('<a>click</a>');
    });

    it('allows relative URLs', () => {
      const html = '<a href="/page">link</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('allows fragment-only URLs', () => {
      const html = '<a href="#section">link</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('blocks javascript: with HTML entity encoding', () => {
      const html = '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('blocks javascript: with URL encoding', () => {
      const html = '<a href="%6A%61%76%61%73%63%72%69%70%74:alert(1)">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('blocks javascript: with mixed case', () => {
      const html = '<a href="JaVaScRiPt:alert(1)">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('blocks javascript: with whitespace', () => {
      const html = '<a href=" java\tscript:alert(1)">click</a>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<a>click</a>');
    });

    it('handles malformed URL encoding gracefully', () => {
      const html = '<a href="%ZZinvalid%encoding">click</a>';
      const result = sanitize(html, DEFAULT_POLICY);
      // Malformed encoding: no protocol detected, treated as relative URL, kept
      expect(result).toBe('<a href="%ZZinvalid%encoding">click</a>');
    });
  });

  describe('maxDepth enforcement', () => {
    it('strips nodes exceeding maxDepth', () => {
      const policy = makePolicy({ maxDepth: 2 });
      // depth 0: <p>, depth 1: <strong>, depth 2: would be stripped
      const html = '<p><strong><em>deep</em></strong></p>';
      const result = sanitize(html, policy);
      expect(result).toBe('<p><strong></strong></p>');
    });

    it('allows nodes within maxDepth', () => {
      const policy = makePolicy({ maxDepth: 3 });
      const html = '<p><strong>text</strong></p>';
      expect(sanitize(html, policy)).toBe(html);
    });
  });

  describe('maxLength enforcement', () => {
    it('truncates text content beyond maxLength', () => {
      const policy = makePolicy({ maxLength: 5 });
      const html = '<p>hello world</p>';
      const result = sanitize(html, policy);
      expect(result).toBe('<p>hello</p>');
    });

    it('truncates across multiple text nodes', () => {
      const policy = makePolicy({ maxLength: 8 });
      const html = '<p>hello </p><p>world</p>';
      const result = sanitize(html, policy);
      expect(result).toBe('<p>hello </p><p>wo</p>');
    });

    it('removes nodes entirely when all length consumed', () => {
      const policy = makePolicy({ maxLength: 5 });
      const html = '<p>hello</p><p>removed</p>';
      const result = sanitize(html, policy);
      expect(result).toBe('<p>hello</p>');
    });
  });

  describe('empty policy', () => {
    it('strips all tags with empty policy, keeping text in unwrap mode', () => {
      const policy: SanitizePolicy = {
        tags: {},
        strip: false,
        maxDepth: 10,
        maxLength: 100_000,
        protocols: [],
      };
      expect(sanitize('<p>hello <strong>world</strong></p>', policy)).toBe('hello world');
    });

    it('strips all content with empty policy in strip mode', () => {
      const policy: SanitizePolicy = {
        tags: {},
        strip: true,
        maxDepth: 10,
        maxLength: 100_000,
        protocols: [],
      };
      expect(sanitize('<p>hello</p>', policy)).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles self-closing tags', () => {
      expect(sanitize('<br>', DEFAULT_POLICY)).toBe('<br>');
    });

    it('handles mixed content', () => {
      const html = 'text before <p>inside</p> text after';
      const result = sanitize(html, DEFAULT_POLICY);
      expect(result).toBe('text before <p>inside</p> text after');
    });

    it('handles deeply nested allowed structure', () => {
      const html = '<ul><li><strong><em>deep</em></strong></li></ul>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe(html);
    });

    it('removes HTML comments', () => {
      const html = '<p>text<!-- comment --></p>';
      expect(sanitize(html, DEFAULT_POLICY)).toBe('<p>text</p>');
    });

    it('handles empty elements', () => {
      expect(sanitize('<p></p>', DEFAULT_POLICY)).toBe('<p></p>');
    });

    it('strips disallowed tags but keeps siblings', () => {
      const policy = makePolicy({ strip: false });
      const html = '<p>before <span>unwrapped</span> after</p>';
      expect(sanitize(html, policy)).toBe('<p>before unwrapped after</p>');
    });
  });

  describe('OWASP XSS vector suite', () => {
    /**
     * For each OWASP vector, sanitize with DEFAULT_POLICY and verify
     * the output contains no dangerous patterns.
     */
    for (const vector of XSS_VECTORS) {
      it(`blocks: ${vector.name}`, () => {
        const result = sanitize(vector.payload, DEFAULT_POLICY);

        // Check no dangerous patterns remain in the output
        for (const pattern of DANGEROUS_PATTERNS) {
          // data: pattern should only flag in URL attribute context, not text content
          if (pattern.source.includes('data') && !result.includes('href=') && !result.includes('src=')) {
            continue;
          }
          expect(result, `Pattern ${pattern} found in: ${result}`).not.toMatch(pattern);
        }
      });
    }

    it('blocks javascript: even when policy.protocols includes it', () => {
      const policy = makePolicy({ protocols: ['https', 'javascript'] });
      const result = sanitize('<a href="javascript:alert(1)">click</a>', policy);
      expect(result).toBe('<a>click</a>');
    });

    it('blocks data: even when policy.protocols includes it', () => {
      const policy = makePolicy({ protocols: ['https', 'data'] });
      const result = sanitize('<a href="data:text/html,evil">click</a>', policy);
      expect(result).toBe('<a>click</a>');
    });

    it('always strips event handler attributes regardless of policy', () => {
      // Even if someone adds onclick to the allowed attributes list,
      // the sanitizer should strip it
      const policy: SanitizePolicy = {
        tags: { p: ['onclick', 'onmouseover'] },
        strip: true,
        maxDepth: 10,
        maxLength: 100_000,
        protocols: ['https'],
      };
      const result = sanitize('<p onclick="alert(1)" onmouseover="alert(2)">text</p>', policy);
      expect(result).toBe('<p>text</p>');
    });

    it('strips all event handlers from allowed tags', () => {
      const events = [
        'onclick', 'onerror', 'onload', 'onfocus', 'onblur',
        'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup',
        'onsubmit', 'onchange', 'oninput', 'ontoggle',
      ];
      for (const event of events) {
        const html = `<p ${event}="alert(1)">text</p>`;
        const result = sanitize(html, DEFAULT_POLICY);
        expect(result, `${event} was not stripped`).toBe('<p>text</p>');
      }
    });

    describe('paste payload sanitization', () => {
      it('cleans Word-style paste (strips classes, styles, spans)', () => {
        const html = '<p class="MsoNormal" style="margin:0"><span style="font-family:Calibri">Hello <b>world</b></span></p>';
        // DEFAULT_POLICY has strip:true, so span (not in whitelist) and its children are removed entirely
        const result = sanitize(html, DEFAULT_POLICY);
        expect(result).toBe('<p></p>');
        expect(result).not.toContain('class=');
        expect(result).not.toContain('style=');
        expect(result).not.toContain('<span');
      });

      it('cleans Word-style paste in unwrap mode (keeps text)', () => {
        const policy = makePolicy({ strip: false });
        const html = '<p class="MsoNormal" style="margin:0"><span style="font-family:Calibri">Hello <b>world</b></span></p>';
        const result = sanitize(html, policy);
        // unwrap mode: span is removed but children promoted, b normalized to strong
        expect(result).toBe('<p>Hello <strong>world</strong></p>');
      });

      it('cleans Google Docs paste (strips spans, ids, styles)', () => {
        const html = '<span style="font-size:11pt" id="docs-internal-guid-abc">Hello <b>world</b></span>';
        // DEFAULT_POLICY has strip:true, so span and its children are removed
        const result = sanitize(html, DEFAULT_POLICY);
        expect(result).not.toContain('<span');
        expect(result).not.toContain('style=');
        expect(result).toBe('');
      });

      it('cleans Google Docs paste in unwrap mode (keeps text)', () => {
        const policy = makePolicy({ strip: false });
        const html = '<span style="font-size:11pt" id="docs-internal-guid-abc">Hello <b>world</b></span>';
        const result = sanitize(html, policy);
        expect(result).not.toContain('<span');
        expect(result).not.toContain('style=');
        expect(result).toContain('<strong>world</strong>');
      });

      it('strips meta and link tags from paste', () => {
        const html = '<meta charset="utf-8"><link rel="stylesheet" href="evil.css"><p>text</p>';
        const result = sanitize(html, DEFAULT_POLICY);
        expect(result).toBe('<p>text</p>');
      });
    });
  });
});
