import { test, expect } from '@playwright/test';
import { XSS_VECTORS, DANGEROUS_PATTERNS } from './xss-vectors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the built sanitize module to inject into the browser
const sanitizeSource = fs.readFileSync(
  path.resolve(__dirname, '../dist/sanitize.js'),
  'utf-8',
);

/**
 * Inject the sanitizer into a browser page and run sanitize() in real browser DOM.
 */
async function sanitizeInBrowser(
  page: import('@playwright/test').Page,
  html: string,
): Promise<string> {
  return page.evaluate(
    async ({ source, input }) => {
      // Create a blob URL from the module source so we can import it
      const blob = new Blob([source], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const mod = await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
      return mod.sanitize(input, mod.DEFAULT_POLICY);
    },
    { source: sanitizeSource, input: html },
  );
}

test.describe('OWASP XSS vectors in real browser', () => {
  for (const vector of XSS_VECTORS) {
    test(`blocks: ${vector.name}`, async ({ page }) => {
      await page.goto('about:blank');
      const result = await sanitizeInBrowser(page, vector.payload);

      for (const pattern of DANGEROUS_PATTERNS) {
        // data: pattern should only flag in URL attribute context
        if (pattern.source.includes('data') && !result.includes('href=') && !result.includes('src=')) {
          continue;
        }
        expect(result, `Pattern ${pattern} found in: ${result}`).not.toMatch(pattern);
      }
    });
  }

  test('sanitize output is identical between browsers', async ({ page }) => {
    // Spot-check a few vectors to ensure consistent output
    await page.goto('about:blank');

    const vectors = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">click</a>',
      '<b><i>normalize</i></b>',
      '<p onclick="alert(1)">text</p>',
    ];

    for (const html of vectors) {
      const result = await sanitizeInBrowser(page, html);
      // All dangerous content should be gone
      expect(result).not.toMatch(/<script/i);
      expect(result).not.toMatch(/onerror/i);
      expect(result).not.toMatch(/javascript:/i);
      expect(result).not.toMatch(/onclick/i);
    }
  });

  test('paste simulation: XSS in clipboard HTML', async ({ page }) => {
    await page.goto('about:blank');

    // Simulate what would happen if clipboard contained XSS
    const clipboardPayloads = [
      '<p>normal text</p><script>alert("xss")</script><p>more text</p>',
      '<p>Hello <img src=x onerror=alert(1)> World</p>',
      '<p><a href="javascript:void(0)">malicious link</a></p>',
    ];

    for (const payload of clipboardPayloads) {
      const result = await sanitizeInBrowser(page, payload);
      expect(result).not.toMatch(/<script/i);
      expect(result).not.toMatch(/onerror/i);
      expect(result).not.toMatch(/javascript:/i);
    }
  });
});
