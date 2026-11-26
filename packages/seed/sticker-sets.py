"""Generates the original AI sticker sets (sticker-sets.json) for Stille Storm
Studio with the OpenAI image API (gpt-image-1.5, medium, transparent PNG) and
turns them into the 512 px WebP masters in sticker-sets/<set>/<key>.webp that
build-packs.mjs publishes as 192 px WebP stickers.

  python3 -I sticker-sets.py generate [set[/key] ...]   # only missing images
  python3 -I sticker-sets.py reject set/key "reason"     # QA: drop, regenerate later
  python3 -I sticker-sets.py clean [set[/key] ...]       # rebuild masters from PNGs
  python3 -I sticker-sets.py cost                        # spend so far

Raw 1024 px PNGs live in sticker-sets/png/ (git-ignored, kept to re-clean);
rejected ones in sticker-sets/png/<set>/rejected/. A rerun only generates
stickers with no PNG yet, so it never pays twice for an accepted image.
The key is read from ~/.config/choreapp/openai.key.
"""
import base64
import io
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sticker-sets')
PNG = os.path.join(OUT, 'png')
USAGE = os.path.join(PNG, 'usage.jsonl')
MODEL = 'gpt-image-1.5'
MAX_IMAGES = 360  # hard budget: 360 x ~$0.04 = ~$14.4
MASTER = 512
# gpt-image-1.5 list prices per 1M tokens (USD)
PRICE = {'text_in': 5.0, 'image_in': 8.0, 'text_out': 10.0, 'image_out': 32.0}

SETS = json.load(open(os.path.join(HERE, 'sticker-sets.json'), encoding='utf-8'))
lock = threading.Lock()

BASE = (
    'A single die-cut sticker, centered on a fully transparent background, square composition, '
    'the whole design fully inside the frame with a small margin, with a thick solid clean white '
    'outline around the whole design. No drop shadow, no glow or haze outside the white outline, '
    'nothing outside the sticker shape.'
)


def prompt(s, st):
    parts = [BASE, f"Subject: {st['subject']}."]
    if s.get('cast'):
        parts.append(s['cast'])
    if st.get('extra'):
        parts.append(st['extra'])
    parts.append(
        f"Style: {s['style']}. Same consistent style as the rest of this sticker set. "
        f"Suitable for children aged {s['ages']}. No text, no letters, no numbers, no logos, "
        'no weapons, no blood. Original design, must not resemble any existing character, '
        'mascot or brand.'
    )
    return '\n\n'.join(parts)


def selected(args):
    for s in SETS:
        for st in s['stickers']:
            if not args or s['slug'] in args or f"{s['slug']}/{st['key']}" in args:
                yield s, st


def images_used():
    if not os.path.exists(USAGE):
        return 0
    return sum(1 for _ in open(USAGE))


def cost():
    total = 0.0
    n = 0
    for line in open(USAGE) if os.path.exists(USAGE) else []:
        u = json.loads(line)['usage'] or {}
        d = u.get('input_tokens_details') or {}
        o = u.get('output_tokens_details') or {}
        img_out = o.get('image_tokens', u.get('output_tokens', 0) - o.get('text_tokens', 0))
        total += (
            d.get('text_tokens', u.get('input_tokens', 0)) * PRICE['text_in']
            + d.get('image_tokens', 0) * PRICE['image_in']
            + o.get('text_tokens', 0) * PRICE['text_out']
            + img_out * PRICE['image_out']
        ) / 1e6
        n += 1
    return n, total


def clean(src, dst):
    """Cuts the faint halo the model leaves outside the white outline.

    Opaque pixels (alpha >= 235) are the sticker; a 1 px blur of that mask gives
    a soft anti-aliased edge, and the result is capped by the original alpha, so
    real edges stay smooth while the haze further out becomes fully transparent.
    Then: trim, centre on a square with a small margin, 512 px master.
    """
    im = Image.open(src).convert('RGBA')
    r, g, b, a = im.split()
    hard = a.point(lambda v: 255 if v >= 235 else 0)
    soft = hard.filter(ImageFilter.GaussianBlur(1.0)).point(lambda v: 0 if v < 24 else v)
    from PIL import ImageChops

    alpha = ImageChops.darker(a, ImageChops.lighter(hard, soft))
    white = Image.new('L', im.size, 255)
    mask0 = alpha.point(lambda v: 255 if v == 0 else 0)
    r, g, b = (Image.composite(white, c, mask0) for c in (r, g, b))
    im = Image.merge('RGBA', (r, g, b, alpha))
    box = alpha.getbbox()
    if box:
        im = im.crop(box)
    side = int(max(im.size) * 1.04)
    sq = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    sq = sq.resize((MASTER, MASTER), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sq.save(dst + '.tmp', 'WEBP', quality=90, alpha_quality=100, method=6)
    os.replace(dst + '.tmp', dst)


def master_path(s, st):
    return os.path.join(OUT, s['slug'], f"{st['key']}.webp")


def png_path(s, st):
    return os.path.join(PNG, s['slug'], f"{st['key']}.png")


def generate_one(key, s, st):
    body = json.dumps(
        {
            'model': MODEL,
            'prompt': prompt(s, st),
            'size': '1024x1024',
            'quality': 'medium',
            'background': 'transparent',
            'output_format': 'png',
            'n': 1,
        }
    ).encode()
    for attempt in range(5):
        req = urllib.request.Request(
            'https://api.openai.com/v1/images/generations',
            data=body,
            headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
        )
        try:
            d = json.load(urllib.request.urlopen(req, timeout=300))
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')[:300]
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(20 * (attempt + 1))
                continue
            print(f"FAIL {s['slug']}/{st['key']}: {e.code} {msg}", flush=True)
            return
        except Exception as e:  # network hiccup
            if attempt < 4:
                time.sleep(10)
                continue
            print(f"FAIL {s['slug']}/{st['key']}: {e}", flush=True)
            return
    png = base64.b64decode(d['data'][0]['b64_json'])
    out = png_path(s, st)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    with lock:
        with open(USAGE, 'a') as f:
            f.write(json.dumps({'id': f"{s['slug']}/{st['key']}", 't': int(time.time()), 'usage': d.get('usage')}) + '\n')
    clean(out, master_path(s, st))
    a = Image.open(out).getchannel('A')
    clear = sum(a.histogram()[:1]) / (a.size[0] * a.size[1])
    print(f"ok {s['slug']}/{st['key']}" + ('' if clear > 0.1 else '  WARN: no transparent background'), flush=True)


def generate(args):
    todo = [(s, st) for s, st in selected(args) if not os.path.exists(png_path(s, st))]
    used = images_used()
    if used + len(todo) > MAX_IMAGES:
        sys.exit(f'budget: {used} generated + {len(todo)} planned > {MAX_IMAGES}')
    key = open(os.path.expanduser('~/.config/choreapp/openai.key')).read().strip()
    print(f'{len(todo)} to generate ({used} so far)', flush=True)
    with ThreadPoolExecutor(5) as ex:
        for s, st in todo:
            ex.submit(generate_one, key, s, st)
    n, c = cost()
    print(f'images {n}, cost ${c:.2f}')


def reject(ref, reason):
    slug, k = ref.split('/')
    src = os.path.join(PNG, slug, f'{k}.png')
    rej = os.path.join(PNG, slug, 'rejected')
    os.makedirs(rej, exist_ok=True)
    n = 1
    while os.path.exists(os.path.join(rej, f'{k}.{n}.png')):
        n += 1
    os.rename(src, os.path.join(rej, f'{k}.{n}.png'))
    m = os.path.join(OUT, slug, f'{k}.webp')
    if os.path.exists(m):
        os.remove(m)
    with open(os.path.join(PNG, 'rejected.log'), 'a') as f:
        f.write(f'{ref}.{n}\t{reason}\n')


if __name__ == '__main__':
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == 'generate':
        generate(rest)
    elif cmd == 'reject':
        reject(rest[0], rest[1])
    elif cmd == 'clean':
        for s, st in selected(rest):
            if os.path.exists(png_path(s, st)):
                clean(png_path(s, st), master_path(s, st))
    elif cmd == 'cost':
        n, c = cost()
        print(f'images {n}, cost ${c:.2f}')
