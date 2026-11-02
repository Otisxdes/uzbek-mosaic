"""
Extract ornament 02 (Star rosette) from its reference image into a symmetric tile layout.

    python3 extract_ornament2.py            # writes ../../tiles-2.json
    python3 extract_ornament2.py --preview  # also writes preview.png next to this script

Input: reference.webp (941 x 1672 px) in this folder.

How it works
    1. Lattice. Single blue tiles are unambiguous in the image, so their centres fix the tile
       grid: 16.46 px across x 14.47 px down (the ornament's tiles are not on a square grid).
    2. Registration. Each lattice cell is nudged by a smooth local offset (a Gaussian-weighted
       average of nearby blue tiles' residuals), so the grid follows the image's gentle drift.
    3. Classification. A cell is a tile if it is clearly blue/turquoise, or — for ivory tiles,
       whose colour is close to the background — if it has a grout ring or is warmer than the
       background. Colours map to the site palette by hue family.
    4. Symmetry. The mirror axes are found where left/right and top/bottom agree best; each cell
       is then decided by a majority of its four mirror positions (ivory needs three of four,
       since it is the noisier class), so the ornament is exactly symmetric.
    5. Placement. Tiles go on the regular lattice, centred on the same axis as ornament 01
       (470, 819.25) so the two ornaments share a centre when the site morphs between them.

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

COBALT, MID, TURQ, PALE = (31, 48, 166), (54, 113, 184), (0, 180, 179), (160, 219, 202)
IVORY, IVORY2, WHITE = (250, 227, 197), (253, 233, 205), (255, 246, 215)
PAL = [COBALT, MID, TURQ, PALE, IVORY, IVORY2, WHITE]    # tie-break priority
IVORIES = {IVORY, IVORY2, WHITE}
BG = np.array([242, 235, 226.])                           # the image's background colour
CENTRE = (470.0, 819.25)                                  # shared with ornament 01


def blue_tiles(rgb):
    """Centres (y, x) of blobs the size of one blue tile face."""
    blue = ndi.binary_opening(rgb[..., 2] - rgb[..., 0] > 70, iterations=1)
    lab, n = ndi.label(blue)
    sizes = ndi.sum(blue, lab, range(1, n + 1))
    cent = np.array(ndi.center_of_mass(blue, lab, range(1, n + 1)))
    return cent[(sizes > 70) & (sizes < 220)]


def fit_axis(v, lo, hi):
    """Pitch and phase that best explain coordinates v as a regular lattice."""
    best = None
    for p in np.arange(lo, hi, 0.002):
        z = np.exp(2j * np.pi * v / p).mean()
        if best is None or abs(z) > best[0]:
            best = (abs(z), p, (np.angle(z) / (2 * np.pi) * p) % p)
    return best[1], best[2]


def sample_cells(rgb, blue):
    h, w, _ = rgb.shape
    g = rgb.mean(2)
    grout = np.clip(ndi.grey_closing(g, size=(5, 5)) - g, 0, 60)
    by, bx = blue[:, 0], blue[:, 1]
    px, ox = fit_axis(bx, 16.0, 16.9)
    py, oy = fit_axis(by, 14.2, 15.0)
    rx = (bx - ox + px / 2) % px - px / 2
    ry = (by - oy + py / 2) % py - py / 2
    tree = cKDTree(np.c_[bx, by])

    def offset(x, y):
        idx = tree.query_ball_point([x, y], 60)
        if not idx:
            return 0.0, 0.0
        d = np.hypot(bx[idx] - x, by[idx] - y)
        wgt = np.exp(-(d / 30) ** 2)
        return float((rx[idx] * wgt).sum() / wgt.sum()), float((ry[idx] * wgt).sum() / wgt.sum())

    cells = []
    for r in range(int((h - oy) // py) + 1):
        for c in range(int((w - ox) // px) + 1):
            x, y = ox + c * px, oy + r * py
            dx, dy = offset(x, y)
            x += dx
            y += dy
            if not (8 < x < w - 8 and 8 < y < h - 8):
                continue
            m = np.median(rgb[int(y) - 3:int(y) + 4, int(x) - 3:int(x) + 4].reshape(-1, 3), 0)
            hx, hy = px / 2, py / 2
            ring = np.concatenate([grout[int(y - hy), int(x - hx + 2):int(x + hx - 1)],
                                   grout[int(y + hy), int(x - hx + 2):int(x + hx - 1)],
                                   grout[int(y - hy + 2):int(y + hy - 1), int(x - hx)],
                                   grout[int(y - hy + 2):int(y + hy - 1), int(x + hx)]])
            inner = grout[int(y) - 3:int(y) + 4, int(x) - 3:int(x) + 4].mean()
            cells.append((c, r, x, y, *m, float(np.abs(m - BG).sum()),
                          float(np.percentile(ring, 60) - inner), float(m[2] - m[0])))
    return cells, (px, py)


def classify(R, G, B, dist, ring, blue):
    if blue > 40:                                         # the blue family
        if G < 95:
            return COBALT
        if G < 160 and R < 110:
            return MID
        if R < 125:
            return TURQ
        return PALE
    if (ring > 4 or (R - B >= 19.5 and dist >= 8)) and dist < 70 and (R + G + B) / 3 > 205:
        return WHITE if (R + G + B) / 3 > 238 else IVORY  # ivory: grout ring, or warmer than background
    return None


def symmetrise(grid):
    present = set(grid)

    def agreement(c2, r2):                                # mirror axes at c2/2, r2/2
        a = t = 0
        for c, r in present:
            for m in ((c2 - c, r), (c, r2 - r)):
                t += 1
                a += m in present
        return a / t

    cs = [c for c, _ in present]
    rs = [r for _, r in present]
    best = max((agreement(c2, r2), c2, r2)
               for c2 in range(min(cs) + max(cs) - 4, min(cs) + max(cs) + 5)
               for r2 in range(min(rs) + max(rs) - 4, min(rs) + max(rs) + 5))
    _, c2, r2 = best

    out = {}
    for c, r in (list(present) + [(c2 - c, r) for c, r in present]
                 + [(c, r2 - r) for c, r in present] + [(c2 - c, r2 - r) for c, r in present]):
        if (c, r) in out:
            continue
        mirrors = {(c, r), (c2 - c, r), (c, r2 - r), (c2 - c, r2 - r)}
        found = [grid[m][2] for m in mirrors if m in grid]
        blues = [k for k in found if k not in IVORIES]
        need = len(mirrors) // 2 + 1 if len(mirrors) > 2 else 1   # clear majority
        if len(blues) >= need:
            pool = blues
        elif len(found) >= need and len(found) * 4 >= 3 * len(mirrors):
            pool = found                                           # ivory: three of four
        elif len(blues) * 2 >= len(mirrors) and len(found) >= need:
            pool = blues                                           # mixed: colour wins
        else:
            continue
        cnt = collections.Counter(pool)
        top = max(cnt.values())
        k = min((k for k in cnt if cnt[k] == top), key=PAL.index)
        for m in mirrors:
            out[m] = k
    return out, (c2 / 2, r2 / 2), best[0]


def preview(tiles, path, scale=0.6):
    from PIL import ImageDraw
    im = Image.new('RGB', (int(941 * scale), int(1672 * scale)), (244, 235, 226))
    d, s = ImageDraw.Draw(im), 12.5 / 2
    for x, y, *c in tiles:
        d.rectangle([(x - s) * scale, (y - s) * scale, (x + s) * scale, (y + s) * scale], fill=tuple(c))
    im.save(path)


def main():
    rgb = np.asarray(Image.open(HERE / 'reference.webp').convert('RGB')).astype(float)
    cells, (px, py) = sample_cells(rgb, blue_tiles(rgb))
    grid = {}
    for c, r, x, y, R, G, B, dist, ring, blue in cells:
        k = classify(R, G, B, dist, ring, blue)
        if k:
            grid[(int(c), int(r))] = (x, y, k)
    out, (ac, ar), agree = symmetrise(grid)
    ax, ay = CENTRE
    tiles = [[round(ax + (c - ac) * px, 3), round(ay + (r - ar) * py, 3), *k] for (c, r), k in out.items()]
    (SITE / 'tiles-2.json').write_text(json.dumps(tiles, separators=(',', ':')))
    print(f'lattice {px:.3f} x {py:.3f} px, mirror axes col {ac} row {ar} (agreement {agree:.3f})')
    print(f'{len(tiles)} tiles → {SITE / "tiles-2.json"}')
    if '--preview' in sys.argv:
        preview(tiles, HERE / 'preview.png')
        print('preview →', HERE / 'preview.png')


if __name__ == '__main__':
    main()
