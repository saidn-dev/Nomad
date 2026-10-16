# Nomad — app

The Nomad rider app: an offline, serverless ride-hailing client. Milestone 1 is a
fully offline dark map of Uganda with tap-to-drop pin: the whole country at the
low zooms, Kampala in street-level detail. See `../PLAN.md` for the milestone
plan.

This app runs on **two platforms from one codebase**:

| | Android / iOS | Browser (web) |
| :--- | :--- | :--- |
| Map engine | `@maplibre/maplibre-react-native` | MapLibre GL JS |
| Tiles | `mbtiles://` from the bundled archive | `pmtiles://` over HTTP range requests |
| Purpose | The real product | Fast design iteration, and a publishable site |

The whole point is that **`App.js` is shared**. Everything platform-specific is
isolated behind two modules that the bundler swaps by file extension.

## Layout

```
App.js                      screen layout, HUD, colours — shared, platform-agnostic
src/mapStyle.js             buildKampalaStyle(tileUrl, { dark, glyphs }) — shared
src/uganda.js               country bounds, zoom ceiling, zoom-out limit maths
src/glyphs.js               native label glyphs (expo-file-system + expo-asset)
src/glyphs.web.js           web label glyphs    (served from public/fonts)
src/NomadMap.js             native map   (maplibre-react-native)
src/NomadMap.web.js         web map      (MapLibre GL JS)   <- only divergence
src/useOfflineTiles.js      native tiles (expo-asset + mbtiles://)
src/useOfflineTiles.web.js  web tiles    (pmtiles://)
assets/fonts/<stack>/<range>.pbf  offline label glyphs, bundled into the app
public/city.pmtiles         offline tile archive served to the browser (generated)
public/fonts/               the same glyphs, copied here for the browser (generated)
public/maplibre-gl-worker.mjs MapLibre's worker; checked in, auto-synced
scripts/sync-maplibre-worker.mjs  regenerates the worker from node_modules
scripts/sync-fonts.mjs      copies assets/fonts -> public/fonts
```

## Run the browser preview

```bash
npm run web          # -> http://localhost:8081
```

Edit colours and layout in `App.js` and the browser hot-reloads. (Edits to the map
*palette* in `src/mapStyle.js` need a page refresh, because the style object is
memoised.)

The preview makes **zero network requests** once loaded — you can confirm it in
DevTools, or by turning off Wi-Fi.

## Run on a device

```bash
npx expo run:android         # dev build
# release build (no Metro; see PLAN.md):
cd android && .\gradlew.bat assembleRelease
```

## The offline tiles

`assets/city.mbtiles` is one archive built from two extracts, so the file name is
a little narrower than its contents:

| Zooms | Covers | Source |
| :--- | :--- | :--- |
| z0–10 | all of Uganda | Uganda `.osm.pbf`, Planetiler |
| z11–15 | Kampala only | Kampala `.osm.pbf`, Planetiler |

The low zooms exist so the user can zoom out and see the whole country; the high
zooms only exist for Kampala, which is where the app is actually used. Both
halves are the OpenMapTiles schema, so the single style in `src/mapStyle.js`
renders either without special-casing.

The device ships the archive directly (SQLite, read via `mbtiles://`). Browsers
cannot read SQLite, so the web build uses **PMTiles** — the same tiles in a single
static file that is read with HTTP range requests, which any static host supports.

`public/city.pmtiles` is generated and deliberately **not committed**. To
regenerate after changing either extract:

```bash
# download the converter once from
# https://github.com/protomaps/go-pmtiles/releases  (Windows x86_64 zip)
pmtiles convert assets/city.mbtiles public/city.pmtiles
```

## The offline glyphs

MapLibre draws text from "glyph" PBFs — one file per font per 256-codepoint
range — and fetches them from the URL template in `style.glyphs`. To stay
offline, the app ships its own copies in `assets/fonts/` and never touches the
network:

- **Native** (`src/glyphs.js`): `useGlyphs()` copies the PBFs out of the app
  bundle into `Paths.document/fonts/` on first launch, then points
  `style.glyphs` at that `file://` directory.
- **Web** (`src/glyphs.web.js`): the same files are copied into `public/fonts/`
  by `scripts/sync-fonts.mjs` and served as static assets.

Fontstack names are deliberately space-free (`NotoSansRegular`, `NotoSansBold`),
which also makes them valid directory names. Only the ranges the tile data
actually needs are shipped; `8192-8447` is the General Punctuation range, for the
curly apostrophe in names like `Kabaka's`.

## Build a deployable site

```bash
npm run build:web            # -> dist/   (includes city.pmtiles)
```

Everything the browser needs ends up in `dist/`: the HTML, the JS/CSS bundles,
`city.pmtiles`, and `maplibre-gl-worker.mjs`. `public/` is copied to the root of
`dist/` by Expo.

### Deploying

`city.pmtiles` is ~48 MB and is **not** in git, so a CI build from the repository
alone cannot produce a working site. Deploy the locally built `dist/` instead:

- **Netlify** — `npx netlify-cli deploy --dir dist --prod`, or drag `dist/` onto
  the Netlify UI. `public/_redirects` ships inside `dist/` and configures the
  single-page-app rewrite.
- **GitHub Pages** — the repo is a *project* site, served under
  `https://<user>.github.io/Nomad/`. Because `index.html` uses absolute paths,
  set a base URL first:

  ```jsonc
  // app.json
  "experiments": { "baseUrl": "/Nomad" }
  ```

  then `npm run build:web` and `npx gh-pages --nojekyll -d dist`. `baseUrl` also
  moves the dev server to `http://localhost:8081/Nomad/`, so remove it when you
  go back to day-to-day development. A user/organisation Pages site or a custom
  domain is served from the root and needs no `baseUrl`.

Any static host works as long as it supports **HTTP range requests** for
`city.pmtiles` (all mainstream hosts do).

## Camera limits

Because there are no tiles outside Uganda, the camera is fenced in:

- **Pan** is clamped to the country box in `src/uganda.js`.
- **Zoom out** is limited to the lowest zoom at which Uganda still covers the
  whole viewport — below that you would see blank canvas past the border.
  That zoom depends on the viewport, so `coverZoom(width, height)` computes it
  and both platforms recompute on resize (`ResizeObserver` on web,
  `useWindowDimensions` on native). On a portrait phone it lands near z6.5; a
  wide desktop window pushes it up past z7.9.
- **Zoom in** stops at z16, one level past the z15 the tiles hold.

The two platforms express the same idea through different APIs: MapLibre GL JS
takes `maxBounds` as `[[west, south], [east, north]]`, whereas
maplibre-react-native takes a flat `[west, south, east, north]`.

## Gotcha: MapLibre's web worker

MapLibre GL JS resolves its tile-parsing worker at runtime as
`new URL('./maplibre-gl-worker.mjs', <bundle url>)`. Metro bundles everything into
one file, so that URL does not exist and tile parsing silently fails. The fix:
serve the worker from `public/` and point MapLibre at it.

`scripts/sync-maplibre-worker.mjs` copies the worker out of `node_modules` and
runs automatically on `postinstall`, `preweb`, and `prebuild:web`, so it always
matches the installed `maplibre-gl` version.
