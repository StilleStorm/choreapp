"""Converts the theme avatar originals (1024x1024 RGBA PNG, <themeId>_<key>.png,
generated for Stille Storm Studio with OpenAI gpt-image-1.5) into the 256x256
WebP files in theme-avatars/ that build-packs.mjs publishes.

Keeps transparency; lowers the quality per image until it fits in 25 KB.
Usage: python3 -I theme-avatars.py <dir with PNGs> theme-avatars
"""
import glob
import io
import os
import sys

from PIL import Image

MAX_BYTES = 25_000

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
total = 0
for path in sorted(glob.glob(os.path.join(src, '*.png'))):
    name = os.path.basename(path)
    if name.endswith('_256.png'):
        continue
    im = Image.open(path).convert('RGBA').resize((256, 256), Image.LANCZOS)
    for q in range(85, 39, -3):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6, alpha_quality=90)
        if buf.tell() <= MAX_BYTES:
            break
    with open(os.path.join(out, name[:-4] + '.webp'), 'wb') as f:
        f.write(buf.getvalue())
    total += buf.tell()
print(f'total {total} bytes')
