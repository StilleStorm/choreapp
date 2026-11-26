// Task icons bundled in the APK: Fluent Emoji SVGs (task-icons/*.svg, MIT)
// rendered to 192 px WebP in apps/mobile/static/icons/tasks. Shown up to 64 px,
// often 100+ at once (icon picker), where the SVGs were slow to draw.
//
// Usage: node task-icons.mjs
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgToWebp } from './webp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'task-icons');
const out = join(here, '../../apps/mobile/static/icons/tasks');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let n = 0;
for (const f of readdirSync(src).filter((f) => f.endsWith('.svg'))) {
  writeFileSync(join(out, f.replace(/\.svg$/, '.webp')), await svgToWebp(readFileSync(join(src, f), 'utf8'), 192));
  n++;
}
copyFileSync(join(src, 'LICENSE.txt'), join(out, 'LICENSE.txt'));
console.log(`task icons: ${n}`);
