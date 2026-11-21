import { build } from 'esbuild';
import { readFileSync, chmodSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/looks.ts'],
  outfile: 'dist/looks.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['sharp'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});
chmodSync('dist/looks.js', 0o755);
console.log('built dist/looks.js');
