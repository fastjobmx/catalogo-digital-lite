"""Optimise the SneakerHub snapshot and the real template captures for the web.

Reads  scripts/.snapshot/ (from snapshot-sneakerhub.mjs) and ../../docs/capturas-3-1/
Writes src/assets/sneakerhub/*.webp, src/assets/templates/*.webp, src/content/sneakerhub.json
Usage: python scripts/optimize_images.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / 'scripts' / '.snapshot'
CAPTURES = ROOT.parent.parent / 'docs' / 'capturas-3-1'
OUT = ROOT / 'src' / 'assets' / 'sneakerhub'
TEMPLATES = ROOT / 'src' / 'assets' / 'templates'
CONTENT = ROOT / 'src' / 'content' / 'sneakerhub.json'


def webp(src: Path, dest: Path, width: int, quality: int = 82, crop_height: int | None = None) -> tuple[int, int]:
    image = Image.open(src).convert('RGB')
    if crop_height:
        image = image.crop((0, 0, image.width, min(image.height, crop_height)))
    if image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, 'WEBP', quality=quality, method=6)
    return image.size


def square(src: Path, dest: Path, side: int) -> None:
    image = Image.open(src).convert('RGB')
    edge = min(image.size)
    left, top = (image.width - edge) // 2, (image.height - edge) // 2
    image.crop((left, top, left + edge, top + edge)).resize((side, side), Image.LANCZOS).save(dest, 'WEBP', quality=82, method=6)


def main() -> None:
    data = json.loads((SNAP / 'data.json').read_text(encoding='utf-8'))
    sizes = {}
    # Phone screens: 2x captures of a 390 × 844 viewport → 720 px wide textures.
    for name in ('mobile-home', 'mobile-catalog', 'mobile-product', 'mobile-cart'):
        sizes[name] = webp(SNAP / f'{name}.png', OUT / f'{name}.webp', 720, 84)
        webp(SNAP / f'{name}.png', OUT / f'{name}-480.webp', 480, 70)
    for name in ('desktop-home', 'desktop-product'):
        sizes[name] = webp(SNAP / f'{name}.png', OUT / f'{name}.webp', 1440, 80)
        webp(SNAP / f'{name}.png', OUT / f'{name}-960.webp', 960, 80)
    for product in data['products']:
        square(SNAP / f"product-{product['sku']}.img", OUT / f"product-{product['sku']}.webp", 480)
        product['image'] = f"product-{product['sku']}.webp"

    templates = []
    for capture in sorted(CAPTURES.glob('*-escritorio.jpg')):
        key = capture.stem.replace('-escritorio', '')
        webp(capture, TEMPLATES / f'{key}.webp', 960, 78, crop_height=1100)
        templates.append(key)
    data['templates'] = templates
    data['imageSizes'] = sizes
    CONTENT.parent.mkdir(parents=True, exist_ok=True)
    CONTENT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('ok', len(data['products']), 'products,', len(templates), 'templates')


if __name__ == '__main__':
    main()
