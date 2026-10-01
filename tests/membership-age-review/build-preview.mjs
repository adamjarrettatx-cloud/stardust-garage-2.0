import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.resolve(root, '../sdg-age-review-preview');
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['tests/membership-age-review/preview.jsx'],
  outdir: out, bundle: true, format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx' },
  alias: { '@': root },
  plugins: [{ name: 'isolated-next', setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'preview' }));
    b.onLoad({ filter: /.*/, namespace: 'preview' }, a => ({
      loader: 'jsx', resolveDir: root, contents: a.path === 'next/link'
        ? `import React from 'react';export default function Link({href,children,...props}) {return <a href={href} {...props} onClick={e=>{e.preventDefault();window.__previewNavigate?.(href)}}>{children}</a>}`
        : `export function useRouter(){return {refresh(){},push(url){window.__previewNavigate?.(url)}}}`,
    }));
  } }],
});
const css = await postcss([tailwindcss({ base: root })]).process('@import "tailwindcss";', { from: path.join(root, 'app/globals.css') });
await writeFile(path.join(out, 'utilities.css'), css.css);
await cp(path.join(root, 'public/logos'), path.join(out, 'logos'), { recursive: true });
await writeFile(path.join(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDG Membership Age Review Preview</title><link rel="stylesheet" href="./utilities.css"><link rel="stylesheet" href="./preview.css"></head><body><div id="root"></div><script type="module" src="./preview.js"></script></body></html>');
console.log(`Built isolated preview at ${out}`);
