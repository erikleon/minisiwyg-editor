import { build } from 'esbuild';

const entryPoints = {
  index: 'src/index.ts',
  sanitize: 'src/sanitize.ts',
  policy: 'src/policy.ts',
  toolbar: 'src/toolbar.ts',
  'adapters/react': 'src/adapters/react.tsx',
  'adapters/vue': 'src/adapters/vue.ts',
  'adapters/svelte': 'src/adapters/svelte.ts',
};

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'es2020',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'vue', 'svelte'],
  jsx: 'automatic',
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
