import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 5120; // 5kb in bytes

const files = [
  'dist/index.js',
  'dist/sanitize.js',
  'dist/policy.js',
  'dist/toolbar.js',
];

let total = 0;

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`Missing: ${file}`);
    process.exit(1);
  }
  const bytes = gzipSync(readFileSync(file)).byteLength;
  total += bytes;
  console.log(`${file}: ${bytes} bytes gzipped`);
}

console.log(`\nTotal: ${total} bytes gzipped (budget: ${BUDGET})`);

if (total > BUDGET) {
  console.error(`OVER BUDGET by ${total - BUDGET} bytes`);
  process.exit(1);
}

console.log('Size check passed.');
