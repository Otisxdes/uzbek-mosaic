"""
Make ornament 03 (Girih panel) exactly symmetric and grid-aligned.

    python3 refine_ornament3.py            # reads ../../tiles-3.original.json, writes ../../tiles-3.json
    python3 refine_ornament3.py --preview  # also writes preview-refined.png

Run extract_ornament3.py first if the detected tiles need regenerating (it writes tiles-3.json;
copy that to tiles-3.original.json before refining).

How it works
    1. Fold. Every tile is reflected into one quadrant about the panel's symmetry centre
       (471.25, 818.75), found as the point where the panel best matches its own mirror image.
    2. Merge. Mirror copies that land within 6.5 px are one tile: at most one per quadrant, the
       position averaged, the colour voted (ties favour strap colours so lines stay unbroken).
       A tile survives only if at least two quadrants agree; tiles near an axis snap onto it.
    3. Border. The three outer rings sit on the panel's own square grid (49 x 79 tiles) and are
       filled solid, so the frame reads as a clean, continuous border.
    4. Interior grid. Tiles within 3 px of the interior lattice (12.78 x 13.26 px) snap onto it:
       the dark ground and the light polygon fills become perfectly regular.
    5. Straps. Diagonal strap tiles keep their averaged positions, so the strap lines stay
       straight and continuous instead of turning into staircases.
    6. Unfold. The quadrant is mirrored back to all four, so symmetry is exact by construction.

Requires: numpy, scipy.
"""
import collections, json, sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent

CX, CY = 471.25, 818.75                 # symmetry centre
MERGE_R, NEED = 6.5, 2                  # mirror-copy merge radius; quadrants that must agree
PX, PY, SNAP = 12.78, 13.26, 3.0        # interior lattice and snap tolerance
BW, BH, NU, NV = 16.68, 16.75, 24, 39   # border grid: pitch and half-extent in tiles

PAL = {(60, 20, 7): 'dark', (231, 198, 162): 'caramel', (246, 214, 174): 'peach',
       (234, 215, 193): 'cream', (250, 234, 209): 'ivory'}
COL = {v: k for k, v in PAL.items()}
PRI = ['caramel', 'peach', 'cream', 'ivory', 'dark']     # tie-break: keep straps continuous


def colour(cnt):
    top = max(cnt.values())
    return min((k for k in cnt if cnt[k] == top), key=PRI.index)


def fold(tiles):
    """Merge the four mirror copies of every tile into one canonical-quadrant tile."""
    pts = [(abs(x - CX), abs(y - CY), (x >= CX) + 2 * (y >= CY), PAL[tuple(c)]) for x, y, *c in tiles]
    F = np.array([[p[0], p[1]] for p in pts])
    tree = cKDTree(F)
    density = np.array([len(tree.query_ball_point(f, MERGE_R)) for f in F])
    used = np.zeros(len(F), bool)
    out = []
    for i in np.argsort(-density):
        if used[i]:
            continue
        best = {}
        for j in tree.query_ball_point(F[i], MERGE_R):
            if used[j]:
                continue
            d = np.hypot(*(F[j] - F[i]))
            q = pts[j][2]
            if q not in best or d < best[q][0]:
                best[q] = (d, j)
        members = [j for _, j in best.values()]
        used[members] = True
        u, v = F[members].mean(0)
        on_u, on_v = u < 3.0, v < 3.0
        positions = (1 if on_u else 2) * (1 if on_v else 2)
        if len({pts[j][2] for j in members}) < min(NEED, positions):
            continue
        out.append((0.0 if on_u else u, 0.0 if on_v else v, colour(collections.Counter(pts[j][3] for j in members))))
    return out


def align(quadrant):
    in_border = lambda u, v: u >= (NU - 2.5) * BW or v >= (NV - 2.5) * BH
    votes = collections.defaultdict(collections.Counter)
    for u, v, k in quadrant:
        if in_border(u, v):
            votes[(min(NU, round(u / BW)), min(NV, round(v / BH)))][k] += 1
    cells = [(a, b) for a in range(NU + 1) for b in range(NV + 1) if a >= NU - 2 or b >= NV - 2]
    border = {c: colour(votes[c]) for c in cells if c in votes}
    for a, b in cells:
        if (a, b) not in border:
            nb = collections.Counter(border[n] for n in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)) if n in border)
            border[(a, b)] = colour(nb) if nb else 'dark'

    snapped, free = collections.defaultdict(collections.Counter), []
    for u, v, k in quadrant:
        if in_border(u, v):
            continue
        gu, gv = (np.floor(u / PX) + 0.5) * PX, np.round(v / PY) * PY
        if max(abs(u - gu), abs(v - gv)) <= SNAP:
            snapped[(gu, gv)][k] += 1
        else:
            free.append((u, v, k))
    grid = [(u, v, colour(c)) for (u, v), c in snapped.items()]
    gt = cKDTree(np.array([g[:2] for g in grid]))
    free = [f for f in free if gt.query(f[:2])[0] > 6.0]   # strap tile duplicating a snapped one
    return grid + free + [(a * BW, b * BH, k) for (a, b), k in border.items()], len(grid), len(free), len(border)


def unfold(quadrant):
    tiles = []
    for u, v, k in quadrant:
        for su in ((1,) if u < 1e-6 else (1, -1)):
            for sv in ((1,) if v < 1e-6 else (1, -1)):
                tiles.append([round(CX + su * u, 3), round(CY + sv * v, 3), *COL[k]])
    return tiles


def main():
    original = json.loads((SITE / 'tiles-3.original.json').read_text())
    quadrant, n_grid, n_strap, n_border = align(fold(original))
    tiles = unfold(quadrant)
    s = {(x, y): tuple(c) for x, y, *c in tiles}
    bad = sum(1 for (x, y), c in s.items()
              for m in ((round(2 * CX - x, 3), y), (x, round(2 * CY - y, 3))) if s.get(m) != c)
    assert bad == 0, f'{bad} tiles break mirror symmetry'
    (SITE / 'tiles-3.json').write_text(json.dumps(tiles, separators=(',', ':')))
    print(f'quadrant: {n_grid} on grid, {n_strap} strap, {n_border} border → {len(tiles)} tiles (was {len(original)}), '
          f'exactly symmetric → {SITE / "tiles-3.json"}')
    if '--preview' in sys.argv:
        from PIL import Image, ImageDraw
        scale, half = 0.6, 12.5 * 1.1 / 2
        im = Image.new('RGB', (int(941 * scale), int(1672 * scale)), (244, 235, 226))
        d = ImageDraw.Draw(im)
        for x, y, *c in tiles:
            d.rectangle([(x - half) * scale, (y - half) * scale, (x + half) * scale, (y + half) * scale], fill=tuple(c))
        im.save(HERE / 'preview-refined.png')
        print('preview →', HERE / 'preview-refined.png')


if __name__ == '__main__':
    main()
