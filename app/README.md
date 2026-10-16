# Nomad — app

The Nomad rider app: an offline, serverless ride-hailing client. Milestone 1 is a
fully offline dark map of Kampala with tap-to-drop pin. See `../PLAN.md` for the
milestone plan.

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
src/mapStyle.js             buildKampalaStyle(tileUrl, { dark }) — shared
src/NomadMap.js             native map   (maplibre-react-native)
src/NomadMap.web.js         web map      (MapLibre GL JS)   <- only divergence
src/useOfflineTiles.js      native tiles (expo-asset + mbtiles://)
src/useOfflineTiles.web.js  web tiles    (pmtiles://)
public/city.pmtiles         offline tile archive served to the browser (generated)
public/maplibre-gl-worker.mjs MapLibre's worker; checked in, auto-synced
scripts/sync-maplibre-worker.mjs  regenerates the worker from node_modules
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

The device ships `assets/city.mbtiles` (SQLite, read via `mbtiles://`). Browsers
cannot read SQLite, so the web build uses **PMTiles** — the same tiles in a single
static file that is read with HTTP range requests, which any static host supports.

`public/city.pmtiles` is generated and deliberately **not committed**. To
regenerate after changing the extract:

```bash
# download the converter once from
# https://github.com/protomaps/go-pmtiles/releases  (Windows x86_64 zip)
pmtiles convert assets/city.mbtiles public/city.pmtiles
```

## Build a deployable site

```bash
npm run build:web            # -> dist/   (includes city.pmtiles)
```

Everything the browser needs ends up in `dist/`: the HTML, the JS/CSS bundles,
`city.pmtiles`, and `maplibre-gl-worker.mjs`. `public/` is copied to the root of
`dist/` by Expo.

### Deploying

`city.pmtiles` is ~41 MB and is **not** in git, so a CI build from the repository
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

## Gotcha: MapLibre's web worker

MapLibre GL JS resolves its tile-parsing worker at runtime as
`new URL('./maplibre-gl-worker.mjs', <bundle url>)`. Metro bundles everything into
one file, so that URL does not exist and tile parsing silently fails. The fix:
serve the worker from `public/` and point MapLibre at it.

`scripts/sync-maplibre-worker.mjs` copies the worker out of `node_modules` and
runs automatically on `postinstall`, `preweb`, and `prebuild:web`, so it always
matches the installed `maplibre-gl` version.
