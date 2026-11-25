// Avatar frames, drawn here (own work). One per app theme, using the theme's
// colours and motif (packages/seed/themes.json, extracted from the mockups).
// The avatar circle sits in the middle 78% of the 256px canvas (the app draws
// frames at 128% of the avatar size).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const C = 128;
const RING = 106;

const DEFAULTS = {
  kawaii: ['#f7a8c4', '#ffe066', 'hearts'], manga: ['#111111', '#e63946', 'bolts'], pixel: ['#3a2e5f', '#f4d35e', 'pixels'],
  neon: ['#00e5ff', '#ff2bd6', 'bolts'], forest: ['#5b7f3a', '#e9b44c', 'leaves'], magical: ['#c77dff', '#ffd6ff', 'stars'],
  shoujo: ['#ff8fab', '#ffffff', 'bubbles'], notebook: ['#2b59c3', '#e63946', 'dots'], guild: ['#8d6e2f', '#f2c14e', 'stars'],
  ink: ['#1a1a1a', '#c1121f', 'waves'], retro90: ['#ff6f91', '#8fe3ff', 'stars'], space: ['#4361ee', '#f9c74f', 'stars'],
  sport: ['#ef233c', '#ffffff', 'flames'], monsters: ['#7b2cbf', '#80ed99', 'bubbles'], ghosts: ['#5a189a', '#ffb703', 'dots'],
  idols: ['#ff4d8d', '#ffd166', 'stars'], lanterns: ['#d62828', '#fcbf49', 'dots'], waves: ['#1d3557', '#e9c46a', 'waves'],
  detective: ['#6b4f2a', '#d4a373', 'dots'], bento: ['#e76f51', '#f4a261', 'dots'], ducks: ['#f9c74f', '#4cc9f0', 'bubbles'],
  capybara: ['#a47148', '#90be6d', 'leaves'], axolotl: ['#ff99c8', '#a0e7e5', 'bubbles'], comic: ['#111111', '#ffd60a', 'dots'],
  minimal: ['#222222', '#7a7a7a', 'none'],
};
const NAMES = {
  kawaii: 'Pastelowe kawaii', manga: 'Manga shonen', pixel: 'Pikselowe RPG', neon: 'Neonowy mecha', forest: 'Przytulny las',
  magical: 'Czarodziejka', shoujo: 'Manga shoujo', notebook: 'Szkolny zeszyt', guild: 'Gildia isekai', ink: 'Ninja i tusz',
  retro90: 'Retro lat 90.', space: 'Kosmiczna opera', sport: 'Sportowe anime', monsters: 'Potworki', ghosts: 'Duszki',
  idols: 'Idolki na scenie', lanterns: 'Festiwal lampionów', waves: 'Fale i drzeworyt', detective: 'Mała detektyw',
  bento: 'Kawiarenka i bento', ducks: 'Kaczki i gęsi', capybara: 'Kapibara na luzie', axolotl: 'Aksolotl i żabki',
  comic: 'Komiks pop-art', minimal: 'Minimal',
};
const LEGENDARY = new Set(['magical', 'neon', 'space']);
const RARE = new Set(['pixel', 'guild', 'idols', 'lanterns', 'comic', 'ink']);

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function motifShape(motif, x, y, deg, color, stroke) {
  const t = `transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(0)})"`;
  switch (motif) {
    case 'dots':
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${color}" stroke="${stroke}" stroke-width="2.5"/>`;
    case 'stars':
      return `<path ${t} d="M0-11 3.2-3.5 11.4-3.4 4.9 1.6 7.1 9.5 0 4.8-7.1 9.5-4.9 1.6-11.4-3.4-3.2-3.5Z" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'hearts':
      return `<path ${t} d="M0 9C-9 2-11-3-8-7-5-10-1-9 0-6 1-9 5-10 8-7 11-3 9 2 0 9Z" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'leaves':
      return `<path ${t} d="M0-11C7-6 7 6 0 11-7 6-7-6 0-11ZM0-9V9" fill="${color}" stroke="${stroke}" stroke-width="2"/>`;
    case 'pixels':
      return `<rect ${t} x="-7" y="-7" width="14" height="14" fill="${color}" stroke="${stroke}" stroke-width="2.5"/>`;
    case 'bolts':
      return `<path ${t} d="M2-12-7 2H0L-2 12 7-2H0Z" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'waves':
      return `<path ${t} d="M-11 3C-7-5-3-5 0 0S7 5 11-3" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
    case 'flames':
      return `<path ${t} d="M0-12C5-6 8-2 8 3A8 8 0 0 1-8 3C-8-1-5-3-3-7-2-3 0-2 0-2 0-6-1-9 0-12Z" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'bubbles':
      return `<g ${t}><circle r="8" fill="${color}" fill-opacity="0.85" stroke="${stroke}" stroke-width="2"/><circle cx="-3" cy="-3" r="2.2" fill="#fff"/></g>`;
    default:
      return '';
  }
}

function frameSvg(stroke, accent, motif) {
  const parts = [
    `<circle cx="${C}" cy="${C}" r="${RING}" fill="none" stroke="${stroke}" stroke-width="12"/>`,
    `<circle cx="${C}" cy="${C}" r="${RING}" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="${motif === 'none' ? '0' : '2 10'}" stroke-linecap="round"/>`,
  ];
  if (motif !== 'none') {
    const count = motif === 'pixels' ? 12 : 8;
    for (let i = 0; i < count; i++) {
      const deg = (360 / count) * i + 22.5;
      const [x, y] = polar(RING + 4, deg);
      parts.push(motifShape(motif, x, y, deg, i % 2 ? accent : stroke === accent ? '#ffffff' : accent, stroke));
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${parts.join('')}</svg>`;
}

const themesPath = join(here, 'themes.json');
const extracted = existsSync(themesPath) ? JSON.parse(readFileSync(themesPath, 'utf8')) : [];

export const FRAMES = Object.keys(DEFAULTS).map((id) => {
  const t = extracted.find((x) => x.id === id);
  const [stroke, accent, motif] = t?.frame ? [t.frame.stroke, t.frame.accent, t.frame.motif] : DEFAULTS[id];
  return {
    id,
    name: `Ramka: ${NAMES[id]}`,
    rarity: LEGENDARY.has(id) ? 'legendary' : RARE.has(id) ? 'rare' : 'common',
    svg: frameSvg(stroke, accent, motif),
  };
});
