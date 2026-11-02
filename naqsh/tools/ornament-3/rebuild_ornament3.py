"""
Rebuild ornament 03 (Girih panel) on clean grids, following the target reference.

    python3 rebuild_ornament3.py            # writes ../../tiles-3.json
    python3 rebuild_ornament3.py --preview  # also writes preview-rebuilt.png and compare.png

Input: reference-target.webp (941 x 1672 px, transparent outside the panel) in this folder.
Requires: numpy, scipy, pillow, scikit-image.

Why a rebuild
    The reference is a rendered photograph. Its tiles drift (rows bunch up and spread out by up to half a
    tile, tiles grow towards the edges), so tiles detected where they sit come out uneven, overlapping or
    missing. The panel is rebuilt instead: the geometry comes from exact grids and straight strap lines,
    and the reference only decides what goes where.

    1. Frame. A 49 x 79 square grid at the panel's existing size. Four rows deep at the top and bottom,
       three columns deep at the sides, as in the reference; its tiles are drawn 25% larger (7th field).
    2. Interior grid. 56 x 89 cells filling the frame evenly. Each reference row and column is found from
       the detected tiles and mapped, in order, onto one grid row / column ("straightening"), so every
       motif keeps its tile counts and arrangement. One spurious reference row next to the bottom frame
       (it has no counterpart in the mirrored top half) is dropped: 44 rows sit above the rosette row and
       44 below, so the rosette is exactly on the panel centre.
    3. Classes. Every reference pixel is dark ground, peach strap, pale fill or grout (class_map). Ground
       and polygon cells take the class covering most of their footprint, merged with the mirror cell.
    4. Straps. Strap pixels are carried through the straightening, thinned to centre lines, and tiles are
       laid along them as the reference lays them: one per grid column on a mostly horizontal strap (at
       the line's exact height), one per grid row on a mostly vertical one. Diagonals read as straight
       lines, not staircases. Ground cells a strap tile covers give way; grazed ones are nudged clear.
    5. Rosette. Its deliberately angled pieces (the dark V's and slanted ivory edges at the star points)
       are taken from the reference with their own rotation and made symmetric about both axes.
    6. Assembly. Candidates are resolved in priority order on the right half, keeping a minimum spacing
       so no two tiles overlap, then mirrored: the panel is exactly left-right symmetric by construction.
       Top and bottom are not forced to match, so the reference's own top/bottom differences survive.

Output: [x, y, r, g, b, angle] per tile (angle in radians, image orientation), plus a 7th size factor for
frame tiles. Every tile stays independently addressable for the site's animation.
"""
import collections, json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.morphology import remove_small_objects, skeletonize

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent

OUT = {0: (46, 14, 5), 1: (236, 202, 160), 2: (241, 227, 207)}   # the site's dark, peach and pale glazes

# output geometry (data px): the panel keeps its current size and centre
CX, CY = 470.5, 819.25
BNX, BNY = 49, 79                                  # frame grid
BX0, BX1, BY0, BY1 = 66.74, 874.26, 168.49, 1470.01
BPX, BPY = (BX1 - BX0) / (BNX - 1), (BY1 - BY0) / (BNY - 1)
RING_X, RING_Y = 3, 4                              # frame depth: columns at the sides, rows top/bottom
BORDER_SIZE = 1.25                                 # frame tile size relative to an interior tile
NX, NY = 56, 89                                    # interior grid
IX0, IY0 = BX0 + (RING_X - .5) * BPX, BY0 + (RING_Y - .5) * BPY
IPX, IPY = (2 * (CX - IX0)) / NX, (2 * (CY - IY0)) / NY
MIN_GAP, BORDER_GAP = 0.88, 1.0                    # closest centre spacing, in interior tiles
WARM = 0.775                                       # blue/red below this: a peach polygon, not a pale one

# reference geometry (px)
RCX, RCY = 471.0, 818.5                            # rosette centre / left-right axis in the reference
ROSETTE_R = 82                                     # radius that holds the angled rosette pieces
DROP_ROW_Y = 1381.8                                # the spurious reference row (see 2.)


def load():
    im = Image.open(HERE / 'reference-target.webp').convert('RGBA')
    bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, (0, 0), im)
    return np.asarray(bg).astype(float), np.asarray(im)[..., 3].astype(float)


def detect(rgb, alpha):
    """Tile centres and rotations in the reference (light and dark tiles found separately: the grout
    between two dark tiles is a light line, between two light tiles a dark one)."""
    L = rgb.mean(2)
    panel = ndi.binary_erosion(alpha > 200, iterations=2)

    def peaks(cls, grout):
        m = ndi.binary_opening(cls & ~grout & panel, structure=np.ones((3, 3)))
        dt = ndi.distance_transform_edt(m)
        dts = ndi.gaussian_filter(dt, 1.0)
        pk = np.argwhere((dts == ndi.maximum_filter(dts, size=7)) & (dt >= 2.5))
        pk = sorted(pk.tolist(), key=lambda p: -dts[p[0], p[1]])
        keep, st = [], []
        for y, x in pk:
            if keep and cKDTree(np.array(keep)).query([y, x])[0] < 9.5:
                continue
            keep.append([y, x]); st.append(dts[y, x])
        return np.array(keep, float)[:, ::-1], np.array(st)

    lc, ls = peaks(L >= 150, ndi.grey_closing(L, size=(5, 5)) - L > 10)
    dc, ds = peaks(L < 120, L - ndi.grey_opening(L, size=(5, 5)) > 10)
    C, S = np.r_[lc, dc], np.r_[ls, ds]
    kept = []
    for i in np.argsort(-S):
        if kept and cKDTree(C[kept]).query(C[i])[0] < 8:
            continue
        kept.append(i)
    C = C[kept]
    gx, gy = ndi.sobel(L, 1), ndi.sobel(L, 0)
    ang = []
    for x, y in C:                                               # edge orientation, modulo a quarter turn
        xi, yi = int(round(x)), int(round(y))
        sx, sy = gx[yi - 6:yi + 7, xi - 6:xi + 7], gy[yi - 6:yi + 7, xi - 6:xi + 7]
        ang.append(np.angle(((sx ** 2 + sy ** 2) * np.exp(4j * np.arctan2(sy, sx))).sum()) / 4)
    return C, np.array(ang)


def class_map(rgb):
    """Per-pixel class: 0 dark ground, 1 peach strap, 2 pale fill, -1 grout / bevel edge.
    Fills are told from straps by shape, not only colour: polygon fills are blobs several tiles wide,
    straps are one tile wide, so a morphological opening keeps the former and drops the latter. Clearly warm
    (peach) glaze is strap either way, so the strap outlining a polygon is not swallowed by it."""
    L = rgb.mean(2)
    br = rgb[..., 2] / np.maximum(rgb[..., 0], 1)
    yy, xx = np.mgrid[-11:12, -11:12]
    blob = ndi.binary_opening(ndi.binary_closing(L > 140, structure=np.ones((3, 3))), structure=(xx ** 2 + yy ** 2) <= 121)
    cm = np.full(L.shape, -1, np.int8)
    cm[L < 105] = 0
    light = L > 175
    cm[light & (blob | (br > .80))] = 2
    cm[light & ~blob & (br <= .80)] = 1
    cm[light & (br < .725)] = 1
    return cm, blob


def votes(cm, x0, x1, y0, y1):
    w = cm[y0:y1, x0:x1]
    v = np.array([(w == 0).sum(), (w == 1).sum(), (w == 2).sum()], float)
    return v / max(v.sum(), 1)


def lines(values, start, lo, hi, dmin, dmax):
    """Row (or column) centres: walk out from `start` along a histogram of detected tile positions."""
    h = np.bincount(np.clip(np.round(values * 4).astype(int), 0, None), minlength=int(hi * 4) + 80).astype(float)
    s = ndi.gaussian_filter1d(h, 3.0)
    i = int(start * 4)
    seq = [(i - 20 + int(np.argmax(s[i - 20:i + 21]))) / 4]
    for sgn in (1, -1):
        c = seq[0]
        while True:
            a, b = sorted((c + sgn * dmin, c + sgn * dmax))
            if a < lo or b > hi:
                break
            c = (int(a * 4) + int(np.argmax(s[int(a * 4):int(b * 4) + 1]))) / 4
            seq.append(c)
    return np.array(sorted(seq))


def fit_lines(values, first, last, n, dmin=13.0, dmax=20.0):
    """Exactly n line centres from `first` to `last` (±4 px), spaced dmin..dmax apart, chosen to sit on as
    many detected tiles as possible (dynamic programming over a 0.25 px histogram)."""
    q = 4
    h = np.bincount(np.clip(np.round(values * q).astype(int), 0, None), minlength=int(last * q) + 200).astype(float)
    s = ndi.gaussian_filter1d(h, 3.0)
    span = np.arange(int((first - 4) * q), int((last + 4) * q) + 1)
    score = np.where(np.abs(span - first * q) <= 4 * q, s[span], -np.inf)
    back = []
    for _ in range(n - 1):
        new = np.full_like(score, -np.inf); arg = np.zeros(len(score), int)
        for d in range(int(dmin * q), int(dmax * q) + 1):
            cand = np.r_[np.full(d, -np.inf), score[:-d]]
            better = cand > new
            new[better] = cand[better]; arg[better] = (np.arange(len(score)) - d)[better]
        score = new + s[span]
        back.append(arg)
    score = np.where(np.abs(span - last * q) <= 4 * q, score, -np.inf)
    k = int(np.argmax(score)); out = [k]
    for arg in reversed(back):
        k = arg[k]; out.append(k)
    return span[np.array(out[::-1])] / q


def main():
    rgb, alpha = load()
    C, ang = detect(rgb, alpha)
    x, y = C[:, 0], C[:, 1]
    tree = cKDTree(C)
    cm, blob = class_map(rgb)
    at = lambda px, py, r=3: votes(cm, int(round(px)) - r, int(round(px)) + r + 1, int(round(py)) - r, int(round(py)) + r + 1)
    cls = np.array([at(px, py) for px, py in C])

    # ── reference grids, and the straightening onto the even output grid ──
    rows = lines(y[(x > 125) & (x < 817)], RCY, 236, 1400, 10.0, 16.5)
    rows = rows[np.abs(rows - DROP_ROW_Y) > 2]
    cols = lines(x[(y > 240) & (y < 1395)], RCX - 6, 108, 834, 10.0, 16.5)
    assert (len(cols), len(rows)) == (NX, NY), (len(cols), len(rows))
    assert abs(rows[NY // 2] - RCY) < 1, 'the rosette row must be the middle row'
    bcols = fit_lines(x[(y < 232) & (x > 60) & (x < 882)], 68.2, 873.8, BNX)
    brows = fit_lines(y[((x < 108) | (x > 834)) & (y > 170) & (y < 1460)], 177.2, 1452.0, BNY)

    gx = IX0 + (np.arange(NX) + .5) * IPX
    gy = IY0 + (np.arange(NY) + .5) * IPY
    ec, eg = np.r_[2 * cols[0] - cols[1], cols, 2 * cols[-1] - cols[-2]], np.r_[gx[0] - IPX, gx, gx[-1] + IPX]
    er, eh = np.r_[2 * rows[0] - rows[1], rows, 2 * rows[-1] - rows[-2]], np.r_[gy[0] - IPY, gy, gy[-1] + IPY]
    fx, fy = np.interp(x, ec, eg), np.interp(y, er, eh)

    # ── rosette: angled pieces, folded into one quadrant and made symmetric about both axes ──
    L = rgb.mean(2)
    even = np.array([L[int(round(py)) - 3:int(round(py)) + 4, int(round(px)) - 3:int(round(px)) + 4].std() < 25
                     for px, py in C])                           # a real tile has an even glaze; a gap does not
    angled = (np.hypot(x - RCX, y - RCY) < ROSETTE_R) & (np.abs(ang) > np.radians(9)) & even
    Q = []                                                       # (u, v, angle, class votes, quadrant)
    for k in np.where(angled)[0]:
        sx, sy = np.sign(fx[k] - CX) or 1, np.sign(fy[k] - CY) or 1
        Q.append((abs(fx[k] - CX), abs(fy[k] - CY), ang[k] * sx * sy, cls[k], (sx, sy)))
    used = [False] * len(Q); free = []
    for a in range(len(Q)):
        if used[a]:
            continue
        grp = [b for b in range(len(Q)) if not used[b] and np.hypot(Q[a][0] - Q[b][0], Q[a][1] - Q[b][1]) < 6]
        quads = {}
        for b in grp:
            quads.setdefault(Q[b][4], b); used[b] = True
        members = list(quads.values())
        if len(members) < 2:
            continue                                             # seen in one quarter only: noise
        u = np.mean([Q[b][0] for b in members]); v = np.mean([Q[b][1] for b in members])
        t = np.mean([Q[b][2] for b in members]); sc = np.sum([Q[b][3] for b in members], 0)
        u, v = (0.0 if u < 3 else u), (0.0 if v < 3 else v)
        if u == 0 or v == 0:                                     # a square on an axis is its own mirror image
            t = 0.0 if abs(t) < np.pi / 8 else np.pi / 4
        free.append((u, v, t, int(sc.argmax())))
    pieces = [(CX + su * u, CY + sv * v, k, t * su * sv) for u, v, t, k in free
              for su in ((1,) if u == 0 else (1, -1)) for sv in ((1,) if v == 0 else (1, -1))]

    # ── ground and polygon cells: the class covering most of the cell, merged with its mirror cell ──
    cb = np.r_[ec[0], (ec[1:] + ec[:-1]) / 2, ec[-1]]          # reference column / row boundaries
    rb = np.r_[er[0], (er[1:] + er[:-1]) / 2, er[-1]]
    def footprint(lo, hi):                                       # middle 70% of a cell
        m = (lo + hi) / 2; h = (hi - lo) * .35
        return int(round(m - h)), int(round(m + h)) + 1
    br = rgb[..., 2] / np.maximum(rgb[..., 0], 1)
    V = np.zeros((NY, NX, 3)); BR = np.ones((NY, NX))
    for j in range(NY):
        y0, y1 = footprint(rb[j + 1], rb[j + 2])
        for i in range(NX):
            x0, x1 = footprint(cb[i + 1], cb[i + 2])
            V[j, i] = votes(cm, x0, x1, y0, y1)
            w = cm[y0:y1, x0:x1] > 0
            BR[j, i] = br[y0:y1, x0:x1][w].mean() if w.any() else 1.0
    LR = V + V[:, ::-1]
    warm = (BR + BR[:, ::-1]) / 2 < WARM                         # peach petals round the rosette
    K = np.where(LR[..., 0] >= LR[..., 2], 0, np.where(warm, 1, 2))

    # ── straps: tiles laid along the reference's strap centre lines ──
    ox = np.arange(int(IX0) - 1, int(np.ceil(2 * CX - IX0)) + 2)
    oy = np.arange(int(IY0) - 1, int(np.ceil(2 * CY - IY0)) + 2)
    sxp = np.clip(np.round(np.interp(ox, eg, ec)).astype(int), 0, cm.shape[1] - 1)
    syp = np.clip(np.round(np.interp(oy, eh, er)).astype(int), 0, cm.shape[0] - 1)
    core = ndi.binary_erosion(blob, iterations=7)[np.ix_(syp, sxp)]   # polygon interiors are never strap
    band = ndi.binary_closing((cm[np.ix_(syp, sxp)] == 1) & ~core, structure=np.ones((5, 5)))   # bridge grout
    band = remove_small_objects(ndi.binary_opening(band, structure=np.ones((3, 3))), max_size=80)
    band = band | band[:, ::-1]                                  # the reference is mirror-symmetric: union
    skel = skeletonize(band)
    sm = ndi.gaussian_filter(band.astype(float), 2.0)
    dy_, dx_ = np.gradient(sm)
    horiz = ndi.gaussian_filter(dy_ * dy_, 3) >= ndi.gaussian_filter(dx_ * dx_, 3)   # strap runs mostly across

    def runs(idx):
        if not len(idx):
            return []
        return [r.mean() for r in np.split(idx, np.where(np.diff(idx) > 2)[0] + 1)]

    samples = []
    for i in range(NX // 2, NX):                                 # right half; mirrored below
        c = int(round(gx[i])) - ox[0]
        samples += [(gx[i], yc + oy[0]) for yc in runs(np.where(skel[:, c - 1:c + 2].any(1) & horiz[:, c])[0])]
    for j in range(NY):
        r = int(round(gy[j])) - oy[0]
        samples += [(xc + ox[0], gy[j]) for xc in runs(np.where(skel[r - 1:r + 2, :].any(0) & ~horiz[r, :])[0])
                    if xc + ox[0] >= CX - 0.25 * IPX]
    kept = []
    for p in samples:                                            # one tile where a row and a column sample meet
        if all(np.hypot(p[0] - q[0], p[1] - q[1]) >= 0.7 * IPX for q in kept):
            kept.append(p)
    straps = []
    for px, py in kept:
        u = px - CX
        straps += [(CX, py)] if abs(u) < 0.25 * IPX else [(CX + u, py), (CX - u, py)]

    # ── assemble: candidates in priority order, resolved on the right half and mirrored ──
    # frame (0) > angled rosette piece (1) > strap (2) > ground in its cell (3) > ground nudged clear of a
    # strap (4) > a spot near an otherwise empty cell (5). A candidate is kept only if it keeps MIN_GAP
    # (frame: BORDER_GAP) from every kept tile and its mirror twin.
    cands = []
    BS = np.zeros((BNY, BNX, 3))
    for b, ry in enumerate(brows):
        for a, rx in enumerate(bcols):
            d, k = tree.query([rx, ry])
            BS[b, a] = cls[k] if d <= 0.45 * BPX else at(rx, ry)
    same = BS.argmax(2) == BS[:, ::-1].argmax(2)
    BK = (BS + BS[:, ::-1] + 0.5 * np.where(same[..., None], 0, 1) * (BS[::-1] + BS[::-1, ::-1])).argmax(2)
    for b in range(BNY):
        for a in range(BNX):
            if a < RING_X or a >= BNX - RING_X or b < RING_Y or b >= BNY - RING_Y:
                cands.append((0, BX0 + a * BPX, BY0 + b * BPY, int(BK[b, a]), 0.0, BORDER_SIZE))
    cands += [(1, px, py, k, t, None) for px, py, k, t in pieces]
    cands += [(2, px, py, 1, 0.0, None) for px, py in straps]
    blockers = np.r_[np.array(straps).reshape(-1, 2), np.array([p[:2] for p in pieces])]
    btree = cKDTree(blockers)
    for j in range(NY):
        for i in range(NX):
            node = np.array([gx[i], gy[j]]); k = int(K[j, i])
            near = btree.query_ball_point(node, 0.95 * IPX)
            if not near:
                cands.append((3, *node, k, 0.0, None))
                continue
            b = blockers[min(near, key=lambda n: np.hypot(*(blockers[n] - node)))]
            off = node - b; dist = np.hypot(*off)
            if dist >= 0.45 * IPX:                               # grazed, not covered: nudge it clear
                cand = b + off / dist * 0.97 * IPX
                if np.hypot(*(cand - node)) <= 0.5 * IPX:
                    cands.append((4, *cand, k, 0.0, None))
            for ddx, ddy in ((0, 0), (.25, 0), (-.25, 0), (0, .25), (0, -.25), (.25, .25), (-.25, .25), (.25, -.25), (-.25, -.25)):
                cands.append((5, node[0] + ddx * IPX, node[1] + ddy * IPY, k, 0.0, None))

    kept, cell = [], {}
    def clear(px, py, size):
        r = (MIN_GAP if size is None else BORDER_GAP) * IPX
        ci, cj = int(px // 16), int(py // 16)
        for a in range(ci - 2, ci + 3):
            for b in range(cj - 2, cj + 3):
                for q in cell.get((a, b), ()):
                    rq = r if q[5] is None else BORDER_GAP * IPX
                    if np.hypot(px - q[1], py - q[2]) < rq or np.hypot(px - (2 * CX - q[1]), py - q[2]) < rq:
                        return False
        return True
    for pr, px, py, k, t, size in sorted((c for c in cands if c[1] >= CX - 1e-6), key=lambda c: (c[0], c[2], c[1])):
        if 0 < px - CX < MIN_GAP * IPX / 2:                      # would collide with its own mirror twin
            if pr != 2:
                continue
            px = CX                                              # a strap crossing the axis: one tile on it
        if pr == 1 or clear(px, py, size):
            q = (pr, px, py, k, t, size)
            kept.append(q); cell.setdefault((int(px // 16), int(py // 16)), []).append(q)

    tiles = []
    def add(px, py, k, angle, size):
        t = [round(float(px), 3), round(float(py), 3), *OUT[k], round(float(angle), 4)]
        tiles.append(t + [size] if size else t)
    for pr, px, py, k, t, size in sorted(kept, key=lambda q: q[0]):
        add(px, py, k, t, size)
        if px - CX > 1e-6:
            add(2 * CX - px, py, k, -t, size)

    # checks: exact left-right symmetry, and no two tiles (outside the rosette's angled pieces) overlapping
    T = np.array([t[:2] for t in tiles]); tt = cKDTree(T)
    d, j = tt.query(np.c_[2 * CX - T[:, 0], T[:, 1]])
    bad = [i for i in range(len(tiles)) if d[i] > .02 or tiles[j[i]][2:5] != tiles[i][2:5]
           or abs(np.sin(2 * (tiles[j[i]][5] + tiles[i][5]))) > 1e-3]
    assert not bad, f'{len(bad)} tiles break left-right symmetry'
    A = np.array([abs(t[5]) > 1e-6 for t in tiles]); d2, j2 = tt.query(T, k=2)
    plain = ~A & ~A[j2[:, 1]]
    assert d2[plain, 1].min() >= MIN_GAP * IPX - 0.01, 'overlapping tiles'

    (SITE / 'tiles-3.json').write_text(json.dumps(tiles, separators=(',', ':')))
    by = collections.Counter(q[0] for q in kept)
    print(f'right half: {by[2]} strap tiles, {by[3]} ground in place, {by[4]} nudged clear of a strap, '
          f'{by[5]} gap spots, {by[1]} angled rosette pieces')
    print(f'{len(tiles)} tiles ({sum(len(t) > 6 for t in tiles)} frame), mirror-symmetric, closest spacing '
          f'{d2[plain, 1].min():.1f} px → {SITE / "tiles-3.json"}')
    if '--preview' in sys.argv:
        preview(tiles, rgb)


def preview(tiles, rgb):
    from PIL import ImageDraw
    S = 2
    im = Image.new('RGB', (941 * S, 1672 * S), (255, 255, 255))
    d = ImageDraw.Draw(im)
    for t in tiles:
        x, y, r, g, b, a = t[:6]
        h = 12.5 * .97 * (t[6] if len(t) > 6 else 1) / 2
        c, s = np.cos(a), np.sin(a)
        d.polygon([((x + h * (c * p - s * q)) * S, (y + h * (s * p + c * q)) * S)
                   for p, q in ((-1, -1), (1, -1), (1, 1), (-1, 1))], fill=(r, g, b))
    im = im.resize((941, 1672), Image.LANCZOS)
    im.resize((565, 1003), Image.LANCZOS).quantize(64).save(HERE / 'preview-rebuilt.png', optimize=True)
    both = Image.new('RGB', (941 * 2 + 20, 1672), (255, 255, 255))
    both.paste(Image.fromarray(rgb.astype(np.uint8)), (0, 0)); both.paste(im, (961, 0))
    both.save(HERE / 'compare.png')                              # full size, for close inspection (not committed)
    print('preview →', HERE / 'preview-rebuilt.png', '| side by side →', HERE / 'compare.png')


if __name__ == '__main__':
    main()
