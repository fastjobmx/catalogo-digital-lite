"""Optimise the public store captures (scripts/snapshot-stores.mjs) for the landing.

Reads  scripts/.stores/<slug>.png (1280 x 800)
Writes scripts/.stores/optimized/<slug>.webp (960 px) and <slug>-480.webp (480 px).
       Copy both files to src/assets/stores/ ONLY after the store authorised appearing on the site:
       the build bundles every file in that folder.
Usage: python scripts/optimize_stores.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'scripts' / '.stores'
OUT = SRC / 'optimized'
OUT.mkdir(parents=True, exist_ok=True)

for png in sorted(SRC.glob('*.png')):
    image = Image.open(png).convert('RGB')
    for width, suffix in ((960, ''), (480, '-480')):
        resized = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
        dest = OUT / f'{png.stem}{suffix}.webp'
        resized.save(dest, 'WEBP', quality=80, method=6)
        print(dest.name, resized.size, dest.stat().st_size // 1024, 'KB')
