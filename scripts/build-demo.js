import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Build a self-contained IIFE bundle just for the demo so the inlined script
// can reference exports by name (e.g. minisiwyg.createEditor).
const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'minisiwyg',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  write: false,
});

const js = result.outputFiles[0].text;
const css = readFileSync('src/toolbar.css', 'utf8');

// Use the production gzipped size from dist/index.js for the footer claim,
// since that's what users actually ship.
const distSize = gzipSync(readFileSync('dist/index.js')).byteLength;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>minisiwyg-editor demo</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { margin-bottom: 0.25rem; }
  .tagline { color: #666; margin-top: 0; }
  .editor {
    min-height: 200px;
    padding: 12px 14px;
    border: 1px solid #ccc;
    border-top: none;
    border-radius: 0 0 4px 4px;
    outline: none;
    line-height: 1.55;
  }
  .editor:focus { border-color: #005fcc; }
  .editor pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow: auto; }
  .editor blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 12px; color: #555; }
  .minisiwyg-toolbar { border-radius: 4px 4px 0 0; border-bottom: none; }
  pre.output {
    margin-top: 1rem; padding: 10px; background: #f4f4f4; border-radius: 4px;
    font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all;
    max-height: 180px; overflow: auto;
  }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; color: #666; font-size: 13px; }
  code { background: #eef; padding: 1px 4px; border-radius: 3px; }
${css}
</style>
</head>
<body>
<h1>minisiwyg-editor</h1>
<p class="tagline">A sub-5kb WYSIWYG editor with built-in XSS protection. Try pasting HTML — including XSS payloads.</p>

<div id="toolbar-host"></div>
<div id="editor" class="editor"><p>Type here, paste HTML, or use the toolbar. Try pasting <code>&lt;img src=x onerror=alert(1)&gt;</code> &mdash; the sanitizer will strip it.</p></div>

<h3>Live HTML output</h3>
<pre class="output" id="output"></pre>

<footer>
  This entire editor is <strong>${distSize} bytes</strong> gzipped (full ESM bundle, all 4 modules).
  <br>Source: <a href="https://github.com/erikleon/minisiwyg-editor">github.com/erikleon/minisiwyg-editor</a>
</footer>

<script>
${js}
(function () {
  var editorEl = document.getElementById('editor');
  var output = document.getElementById('output');
  var editor = minisiwyg.createEditor(editorEl, {
    onChange: function (html) { output.textContent = html; },
  });
  output.textContent = editor.getHTML();
  var toolbar = minisiwyg.createToolbar(editor);
  document.getElementById('toolbar-host').appendChild(toolbar.element);
})();
</script>
</body>
</html>
`;

writeFileSync('demo/index.html', html);
console.log('wrote demo/index.html (full bundle gzipped: ' + distSize + ' bytes)');
