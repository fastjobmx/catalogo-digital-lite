"""Derived brand files with a transparent background.

The originals in brand-originals/ are never modified. This script only turns the
flat white BACKGROUND around each logo transparent:

* White areas that belong to the design stay opaque white: the white cart of the
  icon (enclosed by the dark circle) and the inside of the logo's chat bubble
  (enclosed once two invisible bridge segments close the gaps in its outline
  where the speed lines and the arrow pass; coordinates below, checked visually).
* Letter counters (inside "O", "A"...) are background and become transparent.
* Anti-aliased edges keep the exact colour of the nearest solid artwork pixel;
  only their alpha is derived, so no colour of the logo changes.
* The empty margin is trimmed; the artwork keeps its exact proportions.

Usage: python scripts/brand_transparent.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'brand-originals'
OUT = ROOT / 'src' / 'assets' / 'brand'
PUBLIC = ROOT / 'public'
PREVIEW = ROOT / 'brand-originals' / 'previews'


def disk(radius: int) -> np.ndarray:
    y, x = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    return x * x + y * y <= radius * radius


def transparent(path: Path, bridges: list[tuple[tuple[int, int], tuple[int, int]]] | None = None, keep_region_max_x: int | None = None) -> Image.Image:
    """bridges: invisible segments that close gaps in an outline, used only to tell
    the inside of the emblem from the background. keep_region_max_x: enclosed white is
    kept only left of this x (the emblem); further right (the lettering) every white
    pixel is background, so letter counters become transparent."""
    source = Image.open(path).convert('RGB')
    rgb = np.asarray(source).astype(np.float32)
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    white = (lo >= 236) & (hi - lo <= 14)

    barrier_img = Image.new('L', source.size, 0)
    draw = ImageDraw.Draw(barrier_img)
    for start, end in bridges or []:
        draw.line([start, end], fill=255, width=14)
    barrier = np.asarray(barrier_img) > 0

    # Background = white connected to the image border without crossing artwork or bridges.
    labels, _ = ndimage.label(white & ~barrier)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    outside = np.isin(labels, list(border))
    keep_white = white & ~outside
    keep_white |= white & barrier & ndimage.binary_dilation(keep_white, structure=disk(8))
    if keep_region_max_x is not None:
        keep_white[:, keep_region_max_x:] = False

    background = white & ~keep_white
    alpha = np.where(background, 0.0, 1.0)
    out = rgb.copy()

    # Anti-aliased edge: artwork pixels within 3 px of the background.
    near_bg = ndimage.binary_dilation(background, structure=disk(3)) & ~background & ~keep_white
    solid = ~background & ~near_bg
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    fg = rgb[iy, ix]
    whitev = np.array([255.0, 255.0, 255.0])
    dist_px = np.linalg.norm(whitev - rgb, axis=2)
    dist_fg = np.maximum(np.linalg.norm(whitev - fg, axis=2), 1.0)
    edge_alpha = np.clip(dist_px / dist_fg, 0.0, 1.0)
    alpha = np.where(near_bg, edge_alpha, alpha)
    out = np.where(near_bg[..., None], fg, out)

    rgba = np.dstack([out, alpha * 255.0]).round().clip(0, 255).astype(np.uint8)
    image = Image.fromarray(rgba, 'RGBA')
    bbox = image.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    pad = 6
    return image.crop((max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, image.width), min(bbox[3] + pad, image.height)))


def preview(image: Image.Image, name: str) -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    for label, colour in (('forest', '#102F25'), ('ivory', '#F7F8F3')):
        canvas = Image.new('RGBA', (image.width + 80, image.height + 80), colour)
        canvas.alpha_composite(image, (40, 40))
        canvas.convert('RGB').save(PREVIEW / f'{name}-{label}.png')


def save_web(image: Image.Image, name: str, widths: list[int]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / f'{name}.png', optimize=True)
    for width in widths:
        height = round(image.height * width / image.width)
        image.resize((width, height), Image.LANCZOS).save(OUT / f'{name}-{width}.webp', quality=92, method=6)


def main() -> None:
    logo = transparent(SRC / 'logo-moderno-original.png', bridges=[((122, 440), (148, 562)), ((522, 426), (480, 490))], keep_region_max_x=600)
    save_web(logo, 'logo-principal', [360, 720, 1200])
    preview(logo, 'logo-principal')

    icon = transparent(SRC / 'icono-original.png')
    save_web(icon, 'isotipo', [96, 192])
    preview(icon, 'isotipo')

    # Favicons / avatar. Square canvas, artwork centred, proportions unchanged.
    side = max(icon.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
    PUBLIC.mkdir(parents=True, exist_ok=True)
    square.resize((32, 32), Image.LANCZOS).save(PUBLIC / 'favicon-32.png', optimize=True)
    square.resize((512, 512), Image.LANCZOS).save(PUBLIC / 'icon-512.png', optimize=True)
    # Apple touch icon: the ORIGINAL file (white background) resized, untouched otherwise.
    Image.open(SRC / 'icono-original.png').convert('RGB').resize((180, 180), Image.LANCZOS).save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    print('logo', logo.size, 'icon', icon.size)


if __name__ == '__main__':
    main()
