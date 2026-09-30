import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '../dist/index.js'), 'utf-8');

// Formatting at a collapsed caret depends on real beforeinput events and
// caret handling, which happy-dom does not model, so it is tested here.
async function mount(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.evaluate(async (src) => {
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    const mod = await import(/* @vite-ignore */ url);
    const host = document.createElement('div');
    host.id = 'editor';
    document.body.append(host);
    const editor = mod.createEditor(host);
    document.body.prepend(mod.createToolbar(editor, { actions: ['bold', 'italic', 'underline'] }).element);
    (window as unknown as { editor: unknown }).editor = editor;
  }, source);
  await page.click('#editor');
}

const html = (page: Page) => page.locator('#editor').innerHTML();
const bold = (page: Page) => page.locator('button[aria-label="Bold"]');

test('clicking Bold at the caret makes the next typed text bold', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('Came to the house. ');
  await bold(page).click();
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('Would not leave.');
  expect(await html(page)).toContain('<strong>Would not leave.</strong>');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
});

test('the shortcut works the same way, and formats combine', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('a');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('bc');
  expect(await html(page)).toMatch(/a<(em|strong)><(strong|em)>bc<\/\2><\/\1>/);
});

test('clicking Bold twice cancels it', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('a');
  await bold(page).click();
  await bold(page).click();
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.type('b');
  expect(await html(page)).not.toContain('<strong>');
});

test('moving the caret drops the pending format', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('ab');
  await bold(page).click();
  await page.keyboard.press('ArrowLeft');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.type('x');
  expect(await html(page)).not.toContain('<strong>');
});
