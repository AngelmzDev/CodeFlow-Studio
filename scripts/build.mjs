import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
await mkdir('.build', { recursive: true });
await build({
  entryPoints: ['web/app.js'],
  bundle: true,
  format: 'iife',
  outfile: '.build/app.js',
  target: 'es2022',
  legalComments: 'eof',
  banner: {
    js:
      '/*! @dagrejs/dagre and @dagrejs/graphlib (MIT)\n' +
      (await readFile('node_modules/@dagrejs/dagre/LICENSE', 'utf8')) +
      '\n*/',
  },
  sourcemap: false,
  minify: false,
});
await copyFile('web/index.html', '.build/index.html');
await copyFile('web/styles.css', '.build/styles.css');
console.log('Built local studio and offline viewer bundle.');
