# Composes the sticker booster packs shown when a child opens a new sticker
# (common / rare / legendary). Input: AI-generated blank foil wrappers
# ({rarity}-raw.png, 1024x1536, transparent background, made once with
# gpt-image; no generation here). Steps per pack:
#   1. fill the blank label area with the surrounding foil (mirrored texture),
#      so the sticker collage sits directly on the foil without a panel,
#   2. sticker collage around a small white window with the app logo,
#      every sticker kept whole inside the pack,
#   3. tear line + notch, then split into the top strip and the body.
# The pack title ("Zadania" / "rodzinne misje") is NOT baked in: the app
# renders it as HTML text over the window (translatable). The window's text
# area is printed as fractions of the body image for PackOpening.svelte.
#
# Usage: python3 packages/seed/booster-packs.py [raw_dir] [out_dir]
#   raw_dir default: ~/choreapp-assets/booster-samples
#   out_dir default: apps/mobile/static/packs  (WebP, ~720 px tall, alpha)
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/choreapp-assets/booster-samples')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'apps/mobile/static/packs')
ST = os.path.join(ROOT, 'apps/api/public/builtin/stickers')
LOGO = Image.open(os.path.join(ROOT, 'docs/play/icon-source-1024.png')).convert('RGBA')
TARGET_H = 720  # whole pack height after export

# lab = blank label of the raw wrapper; tear = y of the tear line; bot = top of the bottom crimp
CFG = {
    'common': dict(lab=(290, 426, 738, 1060), tear=250, bot=1250, rim=(196, 214, 238),
                   st=['kieszonkowe-stworki/water-axolotl', 'kieszonkowe-stworki/leaf-hedgehog', 'pluszaki-niespodzianki/cat-bun',
                       'dziwolagi/toaster-whale', 'dziwolagi/cactus-hippo', 'klockowy-swiat/voxel-kid']),
    'rare': dict(lab=(285, 420, 748, 1022), tear=225, bot=1265, rim=(255, 214, 110),
                 st=['kieszonkowe-stworki/fire-fox', 'kieszonkowe-stworki/crystal-beetle', 'pluszaki-niespodzianki/strawberry-cow',
                     'pluszaki-niespodzianki/unboxing', 'smoczy-jezdzcy/egg-hatch', 'magiczne-strazniczki/mascot']),
    'legendary': dict(lab=(284, 425, 736, 1078), tear=250, bot=1255, rim=(255, 196, 232),
                      st=['kieszonkowe-stworki/star-kitten', 'klockowy-swiat/treasure-chest', 'pluszaki-niespodzianki/secret-rare',
                          'retro-arcade/crown', 'magiczne-strazniczki/transformation', 'slowianskie-legendy/river-dragon']),
}
# Sticker slots around the window (fractions of the filled area) and their size.
SLOTS = [(0.24, 0.08), (0.76, 0.09), (0.12, 0.50), (0.88, 0.51), (0.25, 0.93), (0.75, 0.92)]


def rrmask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def shadow_of(im, blur, alpha, off):
    s = Image.new('RGBA', (im.size[0] + 4 * blur, im.size[1] + 4 * blur), (0, 0, 0, 0))
    s.paste(Image.new('RGBA', im.size, (30, 20, 50, alpha)), (2 * blur + off[0], 2 * blur + off[1]), im)
    return s.filter(ImageFilter.GaussianBlur(blur)), 2 * blur


def grade_common(im):
    a = im.getchannel('A')
    l = ImageOps.autocontrast(im.convert('L'), cutoff=1)
    c = ImageOps.colorize(l, black=(18, 32, 58), mid=(118, 148, 186), white=(246, 250, 255)).convert('RGBA')
    out = Image.blend(im, c, 0.65)
    out.putalpha(a)
    return out


def tri(d, b):
    """Triangle-wave reflection of offset d into [0, b)."""
    d = np.mod(d, 2 * b)
    return np.where(d < b, d, 2 * b - 1 - d)


def fill_label(im, box, edges):
    """Replaces box with foil mirrored in from the four sides, weighted by distance."""
    a = np.asarray(im).astype(np.float32)
    x0, y0, x1, y1 = box
    L, R, T, B = edges
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dl, dr, dt, db = xs - x0 + 1, x1 - xs, ys - y0 + 1, y1 - ys
    samples = [
        (a[ys, x0 - 1 - tri(dl - 1, x0 - L)], dl),
        (a[ys, x1 + tri(dr - 1, R - x1)], dr),
        (a[y0 - 1 - tri(dt - 1, y0 - T), xs], dt),
        (a[y1 + tri(db - 1, B - y1), xs], db),
    ]
    acc = np.zeros_like(samples[0][0])
    wsum = np.zeros(dl.shape, np.float32)
    for px, d in samples:
        w = 1.0 / (d.astype(np.float32) ** 2)
        acc += px * w[..., None]
        wsum += w
    patch = Image.fromarray((acc / wsum[..., None]).clip(0, 255).astype(np.uint8), 'RGBA')
    # Soften mirror seams in the middle, keep the edges exact so nothing shows.
    soft = patch.filter(ImageFilter.GaussianBlur(5))
    edge = Image.new('L', patch.size, 0)
    ImageDraw.Draw(edge).rectangle((40, 40, patch.size[0] - 41, patch.size[1] - 41), fill=255)
    patch = Image.composite(soft, patch, edge.filter(ImageFilter.GaussianBlur(20)))
    patch.putalpha(255)
    im.paste(patch, (x0, y0))


def sheen(size, legendary):
    w, h = size
    s = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    if legendary:
        cols = [(255, 150, 200), (255, 220, 140), (160, 240, 190), (140, 200, 255), (200, 160, 255)]
        for i in range(-8, 20):
            d.polygon([(i * 60, 0), (i * 60 + 60, 0), (i * 60 + 60 - h * 0.5, h), (i * 60 - h * 0.5, h)], fill=cols[i % 5] + (40,))
    for bx, bw, al in [(-0.1, 0.18, 50), (0.45, 0.08, 40), (0.75, 0.22, 32)]:
        X = bx * w
        d.polygon([(X, 0), (X + bw * w, 0), (X + bw * w - h * 0.45, h), (X - h * 0.45, h)], fill=(255, 255, 255, al))
    return s.filter(ImageFilter.GaussianBlur(16))


def webp(im, path):
    im.save(path, 'WEBP', quality=82, method=6, alpha_quality=90)
    return os.path.getsize(path)


os.makedirs(OUT, exist_ok=True)
total = 0
for n, c in CFG.items():
    rnd = random.Random(n)
    im = Image.open(os.path.join(RAW, n + '-raw.png')).convert('RGBA')
    if n == 'common':
        im = grade_common(im)
    A = im.getchannel('A')
    x0, y0, x1, y1 = c['lab']
    midrow = [x for x in range(im.size[0]) if A.getpixel((x, (y0 + y1) // 2)) > 128]
    packL, packR = midrow[0] + 14, midrow[-1] - 14
    # 1. foil over the blank label (label border + drop shadow included)
    box = (x0 - 22, y0 - 22, x1 + 22, y1 + 30)
    fill_label(im, box, (packL, packR, c['tear'] + 24, c['bot']))
    bw, bh = box[2] - box[0], box[3] - box[1]
    sh_layer = sheen((bw, bh), n == 'legendary')
    mask = Image.new('L', (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((10, 10, bw - 11, bh - 11), 40, fill=255)
    sh_layer.putalpha(ImageChops.multiply(sh_layer.getchannel('A'), mask.filter(ImageFilter.GaussianBlur(14))))
    im.alpha_composite(sh_layer, (box[0], box[1]))

    # 2a. small window in the middle: logo on top, room for the HTML title below
    pw, ph = bw, bh
    ww, wh = int(pw * 0.54), int(ph * 0.36)
    wx, wy = box[0] + (pw - ww) // 2, box[1] + (ph - wh) // 2 + int(ph * 0.02)
    # 2b. stickers, each kept whole between the pack edges, below the tear line and above the crimp
    sz = int(pw * 0.33)
    safe = (packL + 6, c['tear'] + 30, packR - 6, c['bot'] - 10)
    for (fx, fy), k in zip(SLOTS, c['st']):
        s = Image.open(os.path.join(ST, k + '.webp')).convert('RGBA').resize((sz, sz), Image.LANCZOS)
        s = s.rotate(rnd.uniform(-14, 14), expand=True, resample=Image.BICUBIC)
        s = s.crop(s.getchannel('A').getbbox())
        px = int(box[0] + fx * pw - s.size[0] / 2)
        py = int(box[1] + fy * ph - s.size[1] / 2)
        px = max(safe[0], min(px, safe[2] - s.size[0]))
        py = max(safe[1], min(py, safe[3] - s.size[1]))
        sh, o = shadow_of(s, 8, 90, (4, 8))
        im.alpha_composite(sh, (px - o, py - o))
        im.alpha_composite(s, (px, py))

    win = Image.new('RGBA', (ww, wh), (0, 0, 0, 0))
    dw = ImageDraw.Draw(win)
    dw.rounded_rectangle((0, 0, ww - 1, wh - 1), 34, fill=c['rim'] + (255,))
    dw.rounded_rectangle((7, 7, ww - 8, wh - 8), 28, fill=(255, 255, 255, 245))
    sh, o = shadow_of(win, 12, 110, (0, 10))
    im.alpha_composite(sh, (wx - o, wy - o))
    im.alpha_composite(win, (wx, wy))
    s = int(wh * 0.36)
    lg = LOGO.resize((s, s), Image.LANCZOS)
    lg.putalpha(rrmask((s, s), int(s * 0.22)))
    sh, o = shadow_of(lg, 6, 90, (0, 5))
    lx, ly = wx + (ww - s) // 2, wy + int(wh * 0.09)
    im.alpha_composite(sh, (lx - o, ly - o))
    im.alpha_composite(lg, (lx, ly))
    text_area = (wx + 10, ly + s + int(wh * 0.03), wx + ww - 10, wy + wh - 12)

    # 3. tear line + notch, crop, split
    A = im.getchannel('A')
    ty0 = c['tear']
    row = [x for x in range(im.size[0]) if A.getpixel((x, ty0)) > 128]
    L, R = row[0], row[-1]
    dl = ImageDraw.Draw(im)
    for x in range(L + 30, R - 12, 22):
        dl.line((x, ty0, x + 12, ty0), fill=(255, 255, 255, 200), width=3)
        dl.line((x, ty0 + 3, x + 12, ty0 + 3), fill=(0, 0, 0, 60), width=1)
    m = Image.new('L', im.size, 255)
    ImageDraw.Draw(m).polygon([(L - 2, ty0 - 14), (L + 22, ty0), (L - 2, ty0 + 14)], fill=0)
    im.putalpha(ImageChops.multiply(A, m))
    bb = im.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox()
    bb = (max(0, bb[0] - 8), max(0, bb[1] - 8), min(im.size[0], bb[2] + 8), min(im.size[1], bb[3] + 8))
    im = im.crop(bb)
    cut = ty0 - bb[1]
    k = TARGET_H / im.size[1]
    im = im.resize((round(im.size[0] * k), TARGET_H), Image.LANCZOS)
    cut = round(cut * k)
    W, H = im.size
    zz = [(x, cut + (2 if i % 2 else -2)) for i, x in enumerate(range(0, W + 7, 7))]
    ms = Image.new('L', (W, H), 0)
    ImageDraw.Draw(ms).polygon([(0, 0), (W, 0), (W, cut)] + zz[::-1], fill=255)
    a = im.getchannel('A')
    strip = im.copy()
    strip.putalpha(ImageChops.multiply(a, ms))
    strip = strip.crop((0, 0, W, cut + 3))
    body = im.copy()
    body.putalpha(ImageChops.multiply(a, ImageChops.invert(ms)))
    body = body.crop((0, cut - 3, W, H))
    sizes = webp(strip, os.path.join(OUT, n + '-strip.webp')) + webp(body, os.path.join(OUT, n + '-body.webp'))
    total += sizes
    im.save(os.path.join(RAW, n + '-composed.png'))
    # Text area as fractions of the body image (for the HTML title).
    bx0, by0 = bb[0], bb[1] + (cut - 3) / k
    bH = body.size[1] / k
    bW = W / k
    ta = ((text_area[0] - bx0) / bW, (text_area[1] - by0) / bH, (text_area[2] - bx0) / bW, (text_area[3] - by0) / bH)
    print(f'{n}: pack {W}x{H}, strip {strip.size}, body {body.size}, {sizes // 1024} KB; '
          f'title area (body fractions) left {ta[0]:.3f} top {ta[1]:.3f} right {ta[2]:.3f} bottom {ta[3]:.3f}')
print(f'total {total // 1024} KB')
