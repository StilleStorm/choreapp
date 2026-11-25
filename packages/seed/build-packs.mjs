// Builds the built-in packs:
//  - stickers from Microsoft Fluent Emoji (MIT), one pack per album,
//  - avatars from DiceBear CC0 styles (generated locally),
//  - avatar frames drawn here (own work, "private"), one per app theme.
// Images go to apps/api/public/builtin (Worker static assets: backend data,
// not part of the APK). Rows go to apps/api/seed/builtin.sql (idempotent).
//
// Usage: node build-packs.mjs   (needs network for the Fluent Emoji files)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import * as notionists from '@dicebear/notionists';
import * as openPeeps from '@dicebear/open-peeps';
import * as pixelArt from '@dicebear/pixel-art';
import * as thumbs from '@dicebear/thumbs';
import { optimize } from 'svgo';
import { FRAMES } from './frames.mjs';
import { ALBUMS, LEGENDARY, RARE } from './stickers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '../../apps/api');
const outDir = join(apiDir, 'public/builtin');
const cacheDir = join(here, '.cache');
mkdirSync(cacheDir, { recursive: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const FLUENT_REPO = 'https://github.com/microsoft/fluentui-emoji';
const FLUENT_RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/';
const CREATED_AT = 1795500000000;

const sql = [];
const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** Stable pseudo-random number in [0,1) from a string. */
const hash01 = (s) => createHash('sha256').update(s).digest().readUInt32BE(0) / 2 ** 32;

function svgMin(svg) {
  return optimize(svg, { multipass: true, plugins: ['preset-default'] }).data;
}

function pack(id, name, source, license, attribution) {
  sql.push(
    `INSERT INTO pack (id, family_id, name, source, license, attribution, active, created_at) VALUES (${q(id)}, NULL, ${q(name)}, ${q(source)}, ${q(license)}, ${q(attribution)}, 1, ${CREATED_AT})` +
      ` ON CONFLICT(id) DO UPDATE SET name = excluded.name, source = excluded.source, license = excluded.license, attribution = excluded.attribution;`,
  );
}

function item(id, packId, kind, name, album, rarity, key, price, droppable, sort) {
  sql.push(
    `INSERT INTO item (id, pack_id, kind, name, album, rarity, image_key, price, droppable, sort) VALUES (${q(id)}, ${q(packId)}, ${q(kind)}, ${q(name)}, ${q(album)}, ${q(rarity)}, ${q(key)}, ${price === null ? 'NULL' : price}, ${droppable}, ${sort})` +
      ` ON CONFLICT(id) DO UPDATE SET name = excluded.name, album = excluded.album, rarity = excluded.rarity, image_key = excluded.image_key, price = excluded.price, droppable = excluded.droppable, sort = excluded.sort, deleted_at = NULL;`,
  );
}

function write(key, svg) {
  const path = join(apiDir, 'public', key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
}

// ---------------------------------------------------------------------------
// Stickers: Fluent Emoji (MIT)
// ---------------------------------------------------------------------------

const treePath = join(cacheDir, 'fluent-tree.json');
if (!existsSync(treePath)) {
  const res = await fetch('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1');
  if (!res.ok) throw new Error(`GitHub tree: ${res.status}`);
  writeFileSync(treePath, await res.text());
}
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const colorSvg = new Map();
for (const e of tree.tree) {
  const m = /^assets\/([^/]+)\/Color\/[^/]+\.svg$/.exec(e.path);
  if (m && !colorSvg.has(m[1])) colorSvg.set(m[1], e.path);
}

async function fluent(folder) {
  const path = colorSvg.get(folder);
  if (!path) return null;
  const cache = join(cacheDir, `${slug(folder)}.svg`);
  if (!existsSync(cache)) {
    const res = await fetch(FLUENT_RAW + path.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error(`${folder}: ${res.status}`);
    writeFileSync(cache, await res.text());
  }
  const svg = readFileSync(cache, 'utf8');
  if (!svg.trimStart().startsWith('<svg') || /<script|onload=|foreignObject/i.test(svg)) throw new Error(`unsafe svg ${folder}`);
  return svgMin(svg);
}

let stickerCount = 0;
const missing = [];
const used = new Set();
const tally = { common: 0, rare: 0, legendary: 0, dropOnly: 0, shopOnly: 0 };
for (const album of ALBUMS) {
  const packId = `builtin-fluent-${slug(album.name)}`;
  pack(packId, `${album.name} (Fluent Emoji)`, FLUENT_REPO, 'MIT', 'Fluent Emoji © Microsoft Corporation, licencja MIT');
  let sort = 0;
  for (const [folder, plName] of album.items) {
    if (used.has(folder)) continue; // each sticker lives in one album only
    used.add(folder);
    const svg = await fluent(folder);
    if (!svg) {
      missing.push(folder);
      continue;
    }
    const id = `fluent-${slug(folder)}`;
    const key = `builtin/stickers/${slug(album.name)}/${slug(folder)}.svg`;
    write(key, svg);
    const rarity = LEGENDARY.has(folder) ? 'legendary' : RARE.has(folder) || hash01(`r:${folder}`) < 0.12 ? 'rare' : 'common';
    // About two thirds only drop, one third only in the shop: both ways matter.
    const shopOnly = hash01(`s:${folder}`) < 0.33;
    item(id, packId, 'sticker', plName, album.name, rarity, key, shopOnly ? 0 : null, shopOnly ? 0 : 1, sort++);
    tally[rarity]++;
    tally[shopOnly ? 'shopOnly' : 'dropOnly']++;
    stickerCount++;
  }
}

// ---------------------------------------------------------------------------
// Avatars: DiceBear CC0 styles, rendered locally
// ---------------------------------------------------------------------------

const STYLES = [
  ['lorelei', lorelei, 'Lorelei'],
  ['notionists', notionists, 'Notionists'],
  ['open-peeps', openPeeps, 'Open Peeps'],
  ['pixel-art', pixelArt, 'Pixel Art'],
  ['thumbs', thumbs, 'Thumbs'],
];
const AVATAR_SEEDS = ['Sakura', 'Hiro', 'Yuki', 'Kenta', 'Mika', 'Sora', 'Rin', 'Taro', 'Hana', 'Kaito', 'Nami', 'Ren'];
const BACKGROUNDS = ['ffd5dc', 'c0aede', 'b6e3f4', 'd1f4d9', 'ffdfbf', 'fdf1a6'];
let avatarCount = 0;
for (const [styleId, style, title] of STYLES) {
  const meta = style.meta ?? style.default?.meta;
  if (!meta || !/CC0/.test(meta.license.name)) throw new Error(`${styleId} is not CC0: ${meta?.license?.name}`);
  const packId = `builtin-avatars-${styleId}`;
  pack(
    packId,
    `Awatary: ${title} (DiceBear)`,
    `https://www.dicebear.com/styles/${styleId}/`,
    'CC0-1.0',
    `${meta.title} – ${meta.creator}${meta.creator === 'DiceBear' ? '' : ' (remiks DiceBear)'}, CC0 1.0`,
  );
  AVATAR_SEEDS.forEach((seed, i) => {
    const svg = createAvatar(style, { seed, size: 256, backgroundColor: [BACKGROUNDS[i % BACKGROUNDS.length]], radius: 50 }).toString();
    const key = `builtin/avatars/${styleId}/${slug(seed)}.svg`;
    write(key, svgMin(svg));
    const rarity = i < 8 ? 'common' : i < 11 ? 'rare' : 'legendary';
    item(`avatar-${styleId}-${slug(seed)}`, packId, 'avatar', `${seed}`, `Awatary ${title}`, rarity, key, 0, 0, i);
    avatarCount++;
  });
}

// ---------------------------------------------------------------------------
// Frames: drawn here, one set per theme
// ---------------------------------------------------------------------------

pack('builtin-frames', 'Ramki awatarów', 'własne (wygenerowane w aplikacji)', 'private', null);
FRAMES.forEach((f, i) => {
  const key = `builtin/frames/${f.id}.svg`;
  write(key, svgMin(f.svg));
  item(`frame-${f.id}`, 'builtin-frames', 'frame', f.name, 'Ramki', f.rarity, key, 0, 0, i);
});

const seedDir = join(apiDir, 'seed');
mkdirSync(seedDir, { recursive: true });
writeFileSync(join(seedDir, 'builtin.sql'), `-- Generated by packages/seed/build-packs.mjs. Do not edit by hand.\n${sql.join('\n')}\n`);

console.log(`stickers: ${stickerCount} (${JSON.stringify(tally)})`);
console.log(`avatars: ${avatarCount}, frames: ${FRAMES.length}`);
if (missing.length) console.log(`not found in Fluent Emoji (skipped): ${missing.join(', ')}`);
