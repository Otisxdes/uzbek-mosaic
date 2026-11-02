"""
Extract ornament 03 (Girih panel) from its reference image.

    python3 extract_ornament3.py            # writes ../../tiles-3.json
    python3 extract_ornament3.py --preview  # also writes preview.png next to this script

Input: reference.webp (941 x 1672 px) in this folder.

Why this one is different
    The panel's diagonal straps are laid with staggered, slightly rotated tiles, so no square grid
    can sample it without breaking the lines. Instead every tile is detected where it actually sits:
    light and dark tiles are found separately, each inside its own colour mask, because the grout
    between two dark tiles is a light line while between two light tiles it is a dark one.
    Neighbouring tiles may overlap slightly, exactly as in the source; the site draws this ornament
    with tiles 10% larger and gives every tile a tiny depth offset, so overlaps never flicker.

Colours are snapped to five browns taken from the image: dark ground, caramel and peach straps,
cream and ivory polygon fills. The panel is centred on the axis shared by every ornament.

Requires: numpy, scipy, pillow.
"""
import collections, json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent

PALETTE = {'dark': (60, 20, 7), 'caramel': (231, 198, 162), 'peach': (246, 214, 174),
           'cream': (234, 215, 193), 'ivory': (250, 234, 209)}
PANEL = (slice(190, 1520), slice(55, 885))        # rows, columns of the panel in the image
MIN_SPACING = 12                                    # px between detections of the same colour class
CENTRE = (470.0, 819.25)


def detect(rgb, cls_mask, grout, panel):
    """Tile centres inside one colour class: distance-transform peaks between grout lines."""
    m = ndi.binary_opening(cls_mask & ~grout & panel, structure=np.ones((3, 3)))
    dt = ndi.distance_transform_edt(m)
    dts = ndi.gaussian_filter(dt, 1.0)
    peaks = np.argwhere((dts == ndi.maximum_filter(dts, size=7)) & (dt >= 3.0))
    peaks = sorted(peaks.tolist(), key=lambda p: -dts[p[0], p[1]])
    keep, strength = [], []
    for y, x in peaks:
        if keep and cKDTree(np.array(keep)).query([y, x])[0] < MIN_SPACING:
            continue
        keep.append([y, x])
        strength.append(dts[y, x])
    return np.array(keep, float)[:, ::-1], np.array(strength)


def main():
    rgb = np.asarray(Image.open(HERE / 'reference.webp').convert('RGB')).astype(float)
    h, w, _ = rgb.shape
    lum = rgb.mean(2)
    panel = np.zeros((h, w), bool)
    panel[PANEL] = True

    dark_lines = ndi.grey_closing(lum, size=(5, 5)) - lum     # grout between light tiles
    light_lines = lum - ndi.grey_opening(lum, size=(5, 5))    # grout between dark tiles
    light_c, light_s = detect(rgb, lum >= 140, dark_lines > 12, panel)
    dark_c, dark_s = detect(rgb, lum < 120, light_lines > 10, panel)

    # merge the two classes; where a light and a dark detection coincide keep the stronger one
    centres = np.r_[light_c, dark_c]
    strength = np.r_[light_s, dark_s]
    kept = []
    for i in np.argsort(-strength):
        if kept and cKDTree(centres[kept]).query(centres[i])[0] < 9:
            continue
        kept.append(i)
    centres = centres[kept]

    names = list(PALETTE)
    pal = np.array([PALETTE[n] for n in names], float)
    colours = []
    for x, y in centres:
        m = np.median(rgb[int(y) - 3:int(y) + 4, int(x) - 3:int(x) + 4].reshape(-1, 3), 0)
        colours.append(names[int(np.argmin(((pal - m) ** 2).sum(1)))])

    cx = (centres[:, 0].min() + centres[:, 0].max()) / 2
    cy = (centres[:, 1].min() + centres[:, 1].max()) / 2
    tiles = [[round(float(x - cx + CENTRE[0]), 2), round(float(y - cy + CENTRE[1]), 2), *PALETTE[k]]
             for (x, y), k in zip(centres, colours)]
    (SITE / 'tiles-3.json').write_text(json.dumps(tiles, separators=(',', ':')))
    print(f'{len(light_c)} light + {len(dark_c)} dark detections → {len(tiles)} tiles → {SITE / "tiles-3.json"}')
    print(dict(collections.Counter(colours)))

    if '--preview' in sys.argv:
        from PIL import ImageDraw
        scale, size = 0.6, 12.5 * 1.1
        im = Image.new('RGB', (int(941 * scale), int(1672 * scale)), (244, 235, 226))
        d, s = ImageDraw.Draw(im), size / 2
        for x, y, *c in tiles:
            d.rectangle([(x - s) * scale, (y - s) * scale, (x + s) * scale, (y + s) * scale], fill=tuple(c))
        im.save(HERE / 'preview.png')
        print('preview →', HERE / 'preview.png')


if __name__ == '__main__':
    main()
