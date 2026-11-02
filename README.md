# Uzbek Mosaic — Islamic Tiles

An interactive poster: Uzbek ornaments built from thousands of individual ceramic tiles that
unravel into flowing streams and reassemble. Three ornaments — Medallion, Lattice and Girih —
switch with the ‹ › arrows (or ← → keys).

**Live:** https://otisxdes.github.io/uzbek-mosaic/

## Interaction
- **‹ ›** or **← →** — switch ornament; the change plays as a game of Tetris: the old ornament
  clears line by line, and the new one drops in as four-tile pieces that stack up from the bottom
- **Click the mosaic** or keys **1–4** — step through assembled → unraveling → in flow → returning
- **Move the pointer** — displace nearby tiles

## Structure
- `naqsh/` — the site: `index.html`, `style.css`, `app.js` (Three.js, instanced tiles) and the
  tile data `tiles*.json` (one file per ornament, `[x, y, r, g, b, angle]` per tile)
- `naqsh/tools/` — Python scripts that extracted and refined the ornaments from their reference images
  (the girih panel is traced tile by tile from `tools/ornament-3/reference-target.webp` by `trace_ornament3.py`)
- `first.html` — the first prototype
- `index.html` — redirects to `naqsh/`

## Run locally
```bash
python3 -m http.server 5180
```
then open http://localhost:5180/.

Made by otisxdes.
