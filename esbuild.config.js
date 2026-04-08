import { build } from 'esbuild';

const entryPoints = {
  index: 'src/index.ts',
  sanitize: 'src/sanitize.ts',
  policy: 'src/policy.ts',
  toolbar: 'src/toolbar.ts',
};

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'es2020',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
};

// ESM output
await build({
  ...shared,
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  outExtension: { '.js': '.js' },
});

// CJS output
await build({
  ...shared,
  entryPoints,
  outdir: 'dist',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
});

console.log('Build complete.');
