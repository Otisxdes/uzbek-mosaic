"""
Trace ornament 03 (Girih panel) tile by tile from the target reference.

    python3 trace_ornament3.py            # writes ../../tiles-3.json
    python3 trace_ornament3.py --preview  # also writes preview-traced.png

Input: reference-target.webp (941 x 1672 px, transparent outside the panel) in this folder.
Requires: numpy, scipy, pillow.

The target decides everything: every output tile is a tile of the target, at its position, with its
colour class, its own size (taken from the spacing to its neighbours, since the target's tiles grow
towards the edges) and, where it is visibly angled, its rotation. Nothing is mirrored or regularised.

    1. Detect. Light and dark tiles are found separately (the grout between two dark tiles is a light
       line, between two light tiles a dark one) as distance-transform peaks.
    2. Cover. Wherever a tile's interior is still farther than COVER px from every detected centre, a
       tile is added at the farthest point, moved onto the local centre of that tile; repeated until the
       whole panel is covered. Detections closer than MIN_SEP px are merged.
    3. Read each tile: colour class from its median glaze (dark ground; peach strap or petal; pale fill),
       rotation from its edge orientation when it is clearly angled (> ANGLED degrees, on an even glaze;
       away from the rosette the orientation must also be coherent),
       face size from the median distance to its four nearest neighbours, less a thin grout line.
    4. Place. The target's outer edges map onto the panel's outer edges, and the rosette centre onto the
       panel centre (piecewise linear, so the rosette is exactly centred and the frame keeps its outline).

Output: [x, y, r, g, b, angle, size] per tile; angle in radians (image orientation), size relative to the
ornament's tile. Every tile stays independently addressable for the site's animation.
"""
import json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent

OUT = {0: (46, 14, 5), 1: (236, 202, 160), 2: (241, 227, 207)}   # the site's dark, peach and pale glazes
WARM = 0.775                     # blue/red below this: peach, above: pale
COVER, MIN_SEP = 6.0, 8.0        # px in the target
ANGLED = 9.0                     # degrees
ROSETTE_R = 70                   # px around the rosette centre in the target where pieces are angled
FACE = 12.5 * .97                # the girih tile face in data px at size 1 (app.js: tile .97)
GROUT = 1.0                      # px left between neighbouring faces

# target (px) → panel (data px): outer edges and rosette centre
T_X = (61.0, 471.0, 882.0)       # left edge, rosette centre, right edge in the target
T_Y = (170.0, 818.5, 1460.0)     # top edge, rosette centre, bottom edge
P_X = (59.0, 470.5, 882.0)       # the same in the panel (its current outline; centre is the shared axis)
P_Y = (160.9, 819.25, 1477.6)


def load():
    im = Image.open(HERE / 'reference-target.webp').convert('RGBA')
    bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, (0, 0), im)
    return np.asarray(bg).astype(float), np.asarray(im)[..., 3].astype(float)


def main():
    rgb, alpha = load()
    L = rgb.mean(2)
    panel = ndi.binary_erosion(alpha > 200, iterations=2)
    dark_lines = ndi.grey_closing(L, size=(5, 5)) - L > 10       # grout between light tiles
    light_lines = L - ndi.grey_opening(L, size=(5, 5)) > 10      # grout between dark tiles
    masks = [ndi.binary_opening((L < 120) & ~light_lines & panel, structure=np.ones((3, 3))),
             ndi.binary_opening((L >= 150) & ~dark_lines & panel, structure=np.ones((3, 3)))]
    dts = [ndi.gaussian_filter(ndi.distance_transform_edt(m), 1.0) for m in masks]

    # 1. detect
    pts, strength = [], []
    for dt in dts:
        pk = np.argwhere((dt == ndi.maximum_filter(dt, size=7)) & (dt >= 2.3))
        for y, x in sorted(pk.tolist(), key=lambda p: -dt[p[0], p[1]]):
            pts.append((x, y)); strength.append(dt[y, x])
    order = np.argsort(-np.array(strength)); C = []
    for i in order:
        if C and cKDTree(C).query(pts[i])[0] < MIN_SEP:
            continue
        C.append(pts[i])
    n_det = len(C)

    # 2. cover: add tiles where a tile interior is still uncovered
    interior = (ndi.binary_erosion(masks[0], iterations=1) | ndi.binary_erosion(masks[1], iterations=1))
    best = np.maximum(dts[0], dts[1])
    while True:
        seed = np.zeros(L.shape, bool)
        ci = np.array(C).astype(int); seed[ci[:, 1], ci[:, 0]] = True
        D = ndi.distance_transform_edt(~seed)
        D[~interior] = 0
        added = 0
        for _ in range(400):                                     # several far-apart additions per pass
            y, x = np.unravel_index(np.argmax(D), D.shape)
            if D[y, x] <= COVER:
                break
            y0, x0 = max(y - 3, 0), max(x - 3, 0)                # settle on the local tile centre
            w = best[y0:y + 4, x0:x + 4]
            dy, dx = np.unravel_index(np.argmax(w), w.shape)
            p = (x0 + dx, y0 + dy)
            if cKDTree(C).query(p)[0] >= MIN_SEP:
                C.append(p); added += 1
            D[max(y - 14, 0):y + 15, max(x - 14, 0):x + 15] = 0  # recomputed on the next pass
        if not added:
            break
    C = np.array(C, float)

    # 3. read each tile
    gx, gy = ndi.sobel(L, 1), ndi.sobel(L, 0)
    tree = cKDTree(C)
    d4, _ = tree.query(C, k=5)
    spacing = np.median(d4[:, 1:], axis=1)
    br = rgb[..., 2] / np.maximum(rgb[..., 0], 1)
    tiles_t = []
    for (x, y), s in zip(C, spacing):
        xi, yi = int(round(x)), int(round(y))
        m = np.median(rgb[yi - 2:yi + 3, xi - 2:xi + 3].reshape(-1, 3), 0)
        k = 0 if m.mean() < 120 else (1 if m[2] / max(m[0], 1) < WARM else 2)
        sx, sy = gx[yi - 6:yi + 7, xi - 6:xi + 7], gy[yi - 6:yi + 7, xi - 6:xi + 7]
        z = ((sx ** 2 + sy ** 2) * np.exp(4j * np.arctan2(sy, sx))).sum()
        coherence = abs(z) / max((sx ** 2 + sy ** 2).sum(), 1)
        a = np.angle(z) / 4
        even = L[yi - 3:yi + 4, xi - 3:xi + 4].std() < 25
        if np.hypot(x - T_X[1], y - T_Y[1]) < ROSETTE_R:
            if not even:                                         # the rosette's angled pieces: any clear tilt
                a = 0.0                                          # (a patch with grout showing is a gap, not a tile)
        elif coherence < 0.35 or not even:
            a = 0.0
        if abs(np.degrees(a)) < ANGLED:
            a = 0.0
        tiles_t.append((x, y, k, a, s - GROUT))                  # face: neighbour spacing less a grout line

    # 4. place
    tiles = []
    for x, y, k, a, s in tiles_t:
        px, py = np.interp(x, T_X, P_X), np.interp(y, T_Y, P_Y)
        lx = (P_X[2] - P_X[0]) / (T_X[2] - T_X[0])
        size = float(np.clip(s * lx / FACE, 0.75, 1.35))
        tiles.append([round(float(px), 2), round(float(py), 2), *OUT[k], round(float(a), 4), round(size, 3)])
    (SITE / 'tiles-3.json').write_text(json.dumps(tiles, separators=(',', ':')))
    ks = np.bincount([t[2] for t in tiles_t], minlength=3)
    print(f'{n_det} detected + {len(C) - n_det} added to cover the panel → {len(tiles)} tiles '
          f'(dark {ks[0]}, peach {ks[1]}, pale {ks[2]}; {sum(1 for t in tiles_t if t[3])} angled) → {SITE / "tiles-3.json"}')
    if '--preview' in sys.argv:
        preview(tiles)


def preview(tiles):
    from PIL import ImageDraw
    S = 2
    im = Image.new('RGB', (941 * S, 1672 * S), (255, 255, 255))
    d = ImageDraw.Draw(im)
    for t in tiles:
        x, y, r, g, b, a, s = t
        h = FACE * s / 2; c, sn = np.cos(a), np.sin(a)
        d.polygon([((x + h * (c * p - sn * q)) * S, (y + h * (sn * p + c * q)) * S)
                   for p, q in ((-1, -1), (1, -1), (1, 1), (-1, 1))], fill=(r, g, b))
    im.resize((565, 1003), Image.LANCZOS).quantize(64).save(HERE / 'preview-traced.png', optimize=True)
    print('preview →', HERE / 'preview-traced.png')


if __name__ == '__main__':
    main()
