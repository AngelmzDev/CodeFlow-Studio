import { build } from 'esbuild';
const output = process.argv[2];
if (!output) throw new Error('Output directory required');
await build({
  entryPoints: { cli: 'src/cli.ts', smoke: 'desktop/smoke.ts' },
  outdir: output,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'eof',
  banner: {
    js: 'import { createRequire as portableCreateRequire } from "node:module"; const require = portableCreateRequire(import.meta.url);',
  },
});
