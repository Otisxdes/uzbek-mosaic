"""
Rebuild the ornament around the central square as a symmetric, grid-aligned composition.

    python3 refine_ornament.py            # writes ../../tiles.json
    python3 refine_ornament.py --preview  # also writes preview.png next to this script

Inputs (all in this folder or the site root):
    ../../tiles.original.json   the site's original tile layout; its central square is kept untouched
    reference.webp              the source ornament image (941 x 1672 px)
    reference-tiles.json        centres of the individual tiles detected in that image

How it works
    1. Grid. One lattice centred on the square's axes. Its pitch is chosen so the first ring of
       outer tiles sits exactly one step beyond the square's frame on all four sides.
    2. Registration. Every lattice cell is matched to a tile detected in the reference image, using
       an offset field smoothed over 5x5 cells so whole motifs lock on together instead of drifting.
    3. Motifs. Each recurring ornament is defined once (silhouette + symmetry) in its top-left
       orientation and placed into every quadrant by mirroring, so all copies share identical
       size, tile count and inner pattern. Colours are voted across every symmetric position of
       every copy, keeping the reference's colour arrangement.
    4. Loose elements (rays, dots, spike, border strips) are kept where at least half of their four
       mirror positions carry a tile, with a one-cell clear margin around every motif.

Requires: numpy, scipy, pillow.
"""
import collections, json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent

# Site palette (sRGB), ordered by tie-break priority: structural cobalt first.
PAL = [(31, 48, 166), (54, 113, 184), (0, 180, 179), (160, 219, 202),
       (250, 227, 197), (253, 233, 205), (255, 246, 215)]

# Central square, in reference-image pixels. Tiles inside stay exactly as they are.
SQX, SQY = (216, 723), (546, 1092)
in_square = lambda x, y: SQX[0] <= x <= SQX[1] and SQY[0] <= y <= SQY[1]


def build_grid(square):
    """Lattice centred on the square's axes; first outer ring one pitch beyond its frame."""
    cnt_x = collections.Counter(t[0] for t in square)
    cnt_y = collections.Counter(t[1] for t in square)
    sx = sorted(v for v in cnt_x if cnt_x[v] >= 30)        # the square's 35 columns
    sy = sorted(v for v in cnt_y if cnt_y[v] >= 30)        # and 37 rows
    assert (len(sx), len(sy)) == (35, 37), (len(sx), len(sy))
    ax = ((sx[0] + sx[-1]) / 2 + sx[17]) / 2
    ay = ((sy[0] + sy[-1]) / 2 + sy[18]) / 2
    nx, ny = 17, 18                                         # cells from the axis to the square's edge tiles
    px = ((ax - sx[0]) + (sx[-1] - ax)) / 2 / nx
    py = ((ay - sy[0]) + (sy[-1] - ay)) / 2 / ny
    return dict(ax=ax, ay=ay, px=px, py=py, nx=nx, ny=ny)


def register(grid, img, ref_tiles, original):
    """Map every outer lattice cell to a detected reference tile, coloured with the site palette."""
    ax, ay, px, py, nx, ny = (grid[k] for k in ('ax', 'ay', 'px', 'py', 'nx', 'ny'))

    def sample(x, y):
        return np.median(img[int(y) - 3:int(y) + 4, int(x) - 3:int(x) + 4].reshape(-1, 3), 0)

    # what each palette colour actually looks like in the reference image
    seen = {c: [] for c in PAL}
    for x, y, *c in original:
        seen[tuple(c)].append(sample(x, y))
    ref_col = {c: np.median(np.array(v), 0) for c, v in seen.items()}
    quantise = lambda m: min(PAL, key=lambda c: np.sum((ref_col[c] - m) ** 2))
    colours = [quantise(sample(x, y)) for x, y in ref_tiles]

    tree = cKDTree(ref_tiles)
    ni, nj = int(470 / px) + 2, int(830 / py) + 2
    cells = [(i, j) for i in range(-ni, ni + 1) for j in range(-nj, nj + 1)
             if not (abs(i) <= nx and abs(j) <= ny)]
    pts = np.array([[ax + i * px, ay + j * py] for i, j in cells])

    dist, k = tree.query(pts)
    offset, ok = ref_tiles[k] - pts, dist < 0.6 * px
    index = {c: n for n, c in enumerate(cells)}
    smooth = np.zeros_like(offset)
    for n, (i, j) in enumerate(cells):
        near = [index[(i + a, j + b)] for a in range(-2, 3) for b in range(-2, 3)
                if (i + a, j + b) in index and ok[index[(i + a, j + b)]]]
        smooth[n] = np.median(offset[near], 0) if near else 0

    dist, k = tree.query(pts + smooth)
    reg, used = {}, set()
    for n in np.argsort(dist):                     # closest matches claim their reference tile first
        if dist[n] < 0.4 * px and k[n] not in used:
            reg[cells[n]] = colours[k[n]]
            used.add(k[n])
    return reg


# ── motif library ───────────────────────────────────────────────────────────
def diamond(r):  return [(a, b) for a in range(-r, r + 1) for b in range(-r, r + 1) if abs(a) + abs(b) <= r]
def square3():   return [(a, b) for a in range(-1, 2) for b in range(-1, 2)]
def tri_up(h):   return [(a, b) for b in range(h) for a in range(-b, b + 1)]   # apex at (0,0), widening towards +j

D4 = lambda a, b: {(a, b), (-a, b), (a, -b), (-a, -b), (b, a), (-b, a), (b, -a), (-b, -a)}
MIRROR_I = lambda a, b: {(a, b), (-a, b)}
MIRROR_J = lambda a, b: {(a, b), (a, -b)}


def quad(i, j):
    """One copy per quadrant: (centre i, centre j, mirror i, mirror j). Axis motifs get fewer copies."""
    I = [1, -1] if i else [1]
    J = [1, -1] if j else [1]
    return [(si * i, sj * j, si, sj) for si in I for sj in J]


# name, silhouette (drawn in top-left orientation), colour-symmetry group, copies.
# Centres are lattice cells relative to the square's centre (i → right, j → down).
MOTIFS = [
    ('top diamond',   diamond(8), D4,       quad(0, -33)),
    ('flank diamond', diamond(5), D4,       quad(-17, -26)),
    ('side diamond',  diamond(6), D4,       quad(-24, 0)),
    ('arrow diamond', diamond(3), D4,       quad(-24, -11)),
    ('framed square', square3(),  D4,       quad(-24, -19)),
    ('base triangle', tri_up(5),  MIRROR_I, quad(-8, -24)),
    ('side triangle', [(b, a) for a, b in tri_up(4)], MIRROR_J, quad(-22, -16)),  # base triangle, rotated 90°
]


def place(ci, cj, si, sj, a, b):
    return (ci + a * si, cj + b * sj)


def vote(colours):
    cnt = collections.Counter(colours)
    top = max(cnt.values())
    return min((c for c in cnt if cnt[c] == top), key=PAL.index)


def compose(grid, reg):
    nx, ny = grid['nx'], grid['ny']
    inside = lambda i, j: abs(i) <= nx and abs(j) <= ny

    occupied = {}
    for name, cells, sym, copies in MOTIFS:
        owned, pattern = set(cells), {}
        for a, b in cells:
            if (a, b) in pattern:
                continue
            orbit = {o for o in sym(a, b) if o in owned}
            votes = [reg[place(*n, *o)] for n in copies for o in orbit if place(*n, *o) in reg]
            c = vote(votes) if votes else (250, 227, 197)
            for o in orbit:
                pattern[o] = c
        for n in copies:
            for (a, b), c in pattern.items():
                q = place(*n, a, b)
                assert q not in occupied, f'{name} overlaps another motif at {q}'
                occupied[q] = c

    halo = {(i + a, j + b) for i, j in occupied for a in (-1, 0, 1) for b in (-1, 0, 1)} - set(occupied)
    loose = {}
    ni = max(abs(i) for i, _ in reg) + 1
    nj = max(abs(j) for _, j in reg) + 1
    for i in range(ni + 1):
        for j in range(nj + 1):
            mirrors = {(i, j), (-i, j), (i, -j), (-i, -j)}
            if any(inside(*m) or m in occupied or m in halo for m in mirrors):
                continue
            found = [reg[m] for m in mirrors if m in reg]
            if len(found) * 2 < len(mirrors):
                continue
            c = vote(found)
            for m in mirrors:
                loose[m] = c
    return {k: v for k, v in {**loose, **occupied}.items() if not inside(*k)}, len(occupied), len(loose)


def check(grid, outer):
    bad = [k for k, c in outer.items() for m in ((-k[0], k[1]), (k[0], -k[1])) if outer.get(m) != c]
    assert not bad, f'{len(bad)} cells break mirror symmetry'


def preview(tiles, path, scale=0.6):
    from PIL import ImageDraw
    im = Image.new('RGB', (int(941 * scale), int(1672 * scale)), (244, 235, 226))
    d, s = ImageDraw.Draw(im), 12.5 / 2
    for x, y, *c in tiles:
        d.rectangle([(x - s) * scale, (y - s) * scale, (x + s) * scale, (y + s) * scale], fill=tuple(c))
    im.save(path)


def main():
    original = json.loads((SITE / 'tiles.original.json').read_text())
    img = np.asarray(Image.open(HERE / 'reference.webp').convert('RGB')).astype(float)
    ref_tiles = np.array(json.loads((HERE / 'reference-tiles.json').read_text()), float)

    square = [t for t in original if in_square(t[0], t[1])]
    grid = build_grid(square)
    reg = register(grid, img, ref_tiles, original)
    outer, n_motif, n_loose = compose(grid, reg)
    check(grid, outer)

    tiles = [list(t) for t in square] + [
        [round(float(grid['ax'] + i * grid['px']), 3), round(float(grid['ay'] + j * grid['py']), 3), *c]
        for (i, j), c in outer.items()]
    (SITE / 'tiles.json').write_text(json.dumps(tiles, separators=(',', ':')))
    print(f"grid: axis ({grid['ax']}, {grid['ay']}), pitch {grid['px']:.3f} x {grid['py']:.3f}")
    print(f'square {len(square)} (unchanged), outer {len(outer)} = {n_motif} motif + {n_loose} loose, '
          f'total {len(tiles)} → {SITE / "tiles.json"}')
    if '--preview' in sys.argv:
        preview(tiles, HERE / 'preview.png')
        print('preview →', HERE / 'preview.png')


if __name__ == '__main__':
    main()
