# Nomad — Kampala offline map (browser viewer)

A tiny local web viewer for the **same** `city.mbtiles` bundle the Expo app ships in
`app/assets/city.mbtiles`. It exists so the offline map can be inspected on a desktop
browser (zooming, panning, dropping pins) without flashing a build to an Android device.

Tiles are read straight out of the SQLite file and served over `http://127.0.0.1`. The page
makes **zero** requests to the internet — useful as a quick sanity check that the
Milestone 1 map data really is self-contained.

## Run it

Double-click `open-map.cmd`, or:

```bash
node tools/browser-map/server.mjs
```

Then the browser opens at <http://127.0.0.1:8123/> (Windows: the launcher, macOS/Linux: `open`/`xdg-open`).

| Flag | Default | Purpose |
| :--- | :--- | :--- |
| `--port <n>` | `8123` | Port to listen on (auto-increments if busy). |
| `--mbtiles <path>` | `app/assets/city.mbtiles` | Any OpenMapTiles-schema `.mbtiles` archive. |
| `--no-open` | off | Don't launch a browser. |
| `--verbose` | off | Log every tile hit/miss. |

Requires **Node.js 22+** for the built-in `node:sqlite` module (no `npm install` needed).

## What it does

```
browser ──▶ http://127.0.0.1:8123/tiles/{z}/{x}/{y}.pbf ──▶ SQLite: city.mbtiles
```

* `server.mjs` — a dependency-free HTTP server. Endpoints: `/tiles/{z}/{x}/{y}.pbf`
  (XYZ → TMS row lookup, gzip passthrough), `/tiles.json` (TileJSON from the archive
  metadata), `/style.json`, `/meta.json`, plus static assets.
* `public/` — the page. `app.js` boots MapLibre GL JS, mirroring the app's
  `App.js` pin-drop HUD, and shows live zoom + tile counters so you can watch local tiles
  stream in.
* `vendor/` — vendored [MapLibre GL JS](https://maplibre.org) `6.14.0` (BSD-3-Clause) so
  the viewer stays offline. v6 publishes ESM only, hence `maplibre-gl.mjs` +
  `maplibre-gl-worker.mjs`; `maplibre-gl.css` is unchanged. To update, re-download those
  three files from `https://unpkg.com/maplibre-gl@<version>/dist/`.
* `vendor/fonts/` — the glyph PBFs the label layers need, taken from the MapLibre demo
  tile server (`https://demotiles.maplibre.org/font/Noto Sans Regular/`). Ranges `0-255`,
  `256-511` and `8192-8447` cover ASCII/Latin-1, Latin Extended-A (Luganda `ŋ`) and the
  curly quotes/dashes that appear in OSM names. The typeface is Noto Sans, licensed under
  the SIL Open Font License 1.1. Re-fetch them any time with
  `node tools/browser-map/fetch-fonts.mjs` (the one step that uses the network) — the
  server then serves them from disk, so label rendering is offline too.

## Labels

The archive carries `place` (`city`, `town`, `suburb`, `village`, `island`) and
`transportation_name` (street names), so the viewer adds symbol layers for them:

| Layer | Source | From zoom | Look |
| :--- | :--- | :--- | :--- |
| `place-city` | `place` (`city`) | 6 | White, largest. |
| `place-town` | `place` (`town`) | 9 | White, medium. |
| `place-suburb` | `place` (`suburb`/`borough`/`quarter`/`neighbourhood`) | 11 | Light grey, uppercase, letter-spaced. |
| `place-village` | `place` (`village`/`hamlet`) | 13 | Light grey, smallest. |
| `road-label` | `transportation_name` | 14 | Light grey, along the road. |

Two text colours carry the whole hierarchy — white for the places you navigate by, light
grey for everything else — with size, casing and letter-spacing doing the rest.

MapLibre resolves label collisions by *layer order* (the last layer wins), so the stack
runs least to most important and `Kampala` never gets suppressed by the surrounding
village labels. Text is always `coalesce(name:latin, name_en, name)`, which keeps every
label inside the bundled glyph ranges.

The layers live in `server.mjs` rather than `app/src/mapStyle.js` because they need a glyph
source, which only this viewer serves; the React Native app keeps its label-free style.

## Dark mode

Click the moon/sun button in the top-left panel, or press it in devtools:
`document.getElementById('theme-toggle').click()`.

* On first visit the theme follows your OS (`prefers-color-scheme`); once you click the
  button your choice is remembered in `localStorage` under `nomad.theme`.
* Switching calls `map.setStyle()`, so the camera position, the dropped pin and all
  controls stay exactly where they were.
* `/style-dark.json` is **derived** from `/style.json` at startup — layer order, filters,
  source-layers and all geometry still come from `app/src/mapStyle.js`. Only colour literals
  are swapped, via the `DARK_COLORS` table in `server.mjs`, which also rebuilds data-driven
  colours like the road `match` expression. `DARK_OPACITY` nudges the few fill layers whose
  light opacity reads as too faint on a dark background.
* The palette is a deep slate charcoal canvas (`#191c21`), muted blue-grey water (`#202e39`),
  and fine grey roads where importance reads as *darker*: motorway `#24292f`, trunk `#272c33`,
  primary `#2b3038`, secondary `#2f353d`, everything below `#3a4149`, over a `#121419` casing.
  Labels are white/light grey with a halo set to the background colour, so it tracks the theme
  automatically. Every value is one line in the `DARK_COLORS` table — retune it there.
* Add a new colour to `mapStyle.js` and the server will print
  `warning: no dark counterpart for #xxxxxx` on the next start — drop it into `DARK_COLORS`
  to extend the theme.
* MapLibre's own controls (zoom/compass, attribution, scale bar) ship light-only chrome in
  `maplibre-gl.css`, so `public/style.css` overrides them under `[data-theme='dark']`.

## Sharing the style with the app

The map style is **not** duplicated here. `server.mjs` reads `app/src/mapStyle.js`,
`buildKampalaStyle()`, and serves the result as `/style.json`. Edit the style in one place
and both the mobile app and the browser viewer pick up the change (restart the server).

## Notes

* Missing tiles answer `204 No Content`, which MapLibre treats as an intentionally empty
  tile — outside the archive bounds (Kampala: `32.35,0.1,32.8,0.5`) you'll simply see the
  background colour.
* Glyphs are served from `/fonts/{fontstack}/{range}.pbf` out of `vendor/fonts`; the
  fontstack and range are pattern-checked, so traversal attempts are rejected.
* The header shows the render counters from the current session; `window.__nomadMap` is the
  live MapLibre instance if you want to poke at it from the devtools console.
* Verified headlessly (headless Edge + CDP): 15 style layers load, a z12 Kampala view draws
  `Kampala` plus the surrounding cities/towns and seven city-core neighbourhoods, z14 shows
  Kololo/Naguru/Kamwokya/Wandegeya/Mulago, and z15 draws street names — with no failed
  requests, no console warnings (so no missing glyphs) and **no external requests at all**.
  Clicking the map drops a pin and reports its coordinates. The dark theme was checked the
  same way: the canvas background samples as exactly `#191c21` in dark and `#f8f4f0` in light,
  white and grey label pixels are both present, and the pin, camera and `localStorage` choice
  all survive `setStyle`.
