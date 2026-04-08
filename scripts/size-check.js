import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// 5kb hard limit for the full bundle (index.js re-exports all four modules).
// Subpath bundles are reported for visibility but each one is independently
// bundled by esbuild, so summing them double-counts shared code.
const FULL_BUDGET = 5120;

const entries = [
  { file: 'dist/index.js', label: 'full bundle', enforce: true },
  { file: 'dist/sanitize.js', label: 'sanitize subpath' },
  { file: 'dist/policy.js', label: 'policy subpath' },
  { file: 'dist/toolbar.js', label: 'toolbar subpath' },
];

let failed = false;

for (const { file, label, enforce } of entries) {
  if (!existsSync(file)) {
    console.error(`Missing: ${file}`);
    process.exit(1);
  }
  const bytes = gzipSync(readFileSync(file)).byteLength;
  const tag = enforce ? ` (budget: ${FULL_BUDGET})` : '';
  console.log(`${file} [${label}]: ${bytes} bytes gzipped${tag}`);
  if (enforce && bytes > FULL_BUDGET) {
    console.error(`  OVER BUDGET by ${bytes - FULL_BUDGET} bytes`);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log('\nSize check passed.');
