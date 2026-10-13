#!/usr/bin/env node
/**
 * Nomad — Kampala offline map viewer (browser)
 *
 * Serves the same `city.mbtiles` bundle that the Expo app ships in
 * `app/assets/city.mbtiles`, then renders it in a browser with MapLibre GL JS.
 * No internet is required: tiles come straight out of the local SQLite file.
 *
 * Usage:
 *   node tools/browser-map/server.mjs [--port 8123] [--mbtiles <path>] [--no-open] [--verbose]
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const VENDOR_DIR = join(ROOT, 'vendor');
const FONTS_DIR = join(VENDOR_DIR, 'fonts');
const DEFAULT_MBTILES = join(ROOT, '..', '..', 'app', 'assets', 'city.mbtiles');

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};

const mbtilesPath = resolve(option('--mbtiles', DEFAULT_MBTILES));
const startPort = Number(option('--port', 8123));
const shouldOpen = !flag('--no-open');
const verbose = flag('--verbose');

// ---------------------------------------------------------------- mbtiles

const db = new DatabaseSync(mbtilesPath, { readOnly: true });
const metadata = new Map(
  db.prepare('select name, value from metadata').all().map((r) => [r.name, r.value]),
);

/**
 * Planetiler's compact layout splits tiles across `tiles_shallow` / `tiles_data`;
 * older tools write a single `tiles` table. Support both.
 */
const hasFlatTiles = db
  .prepare("select name from sqlite_master where name = 'tiles' and type in ('table', 'view')")
  .get();
const tileQuery = hasFlatTiles
  ? db.prepare('select tile_data from tiles where zoom_level = ? and tile_column = ? and tile_row = ?')
  : db.prepare(`
      select d.tile_data as tile_data
      from tiles_shallow s
      join tiles_data d on s.tile_data_id = d.tile_data_id
      where s.zoom_level = ? and s.tile_column = ? and s.tile_row = ?
    `);

const num = (name, fallback) => {
  const v = Number(metadata.get(name));
  return Number.isFinite(v) ? v : fallback;
};
const list = (name, fallback) => {
  const v = (metadata.get(name) ?? '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
  return v.length === fallback.length ? v : fallback;
};

const minzoom = num('minzoom', 0);
const maxzoom = num('maxzoom', 15);
const bounds = list('bounds', [-180, -85, 180, 85]);
const center = list('center', [32.5825, 0.3476, 12]);

const tilejson = {
  tilejson: '3.0.0',
  name: metadata.get('name') ?? 'Kampala Offline',
  description: metadata.get('description') ?? '',
  attribution: metadata.get('attribution') ?? '',
  format: metadata.get('format') ?? 'pbf',
  minzoom,
  maxzoom,
  bounds,
  center,
  tiles: ['/tiles/{z}/{x}/{y}.pbf'],
};

async function loadAppStyle() {
  // Reuse the app's own style module (app/src/mapStyle.js) as the single source
  // of truth. It is plain ESM with no imports, so we can load it through a
  // data: URL even though the surrounding package is CommonJS.
  const source = await readFile(new URL('../../app/src/mapStyle.js', import.meta.url), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  return mod.buildKampalaStyle('/tiles.json');
}

// ------------------------------------------------------------ dark theme
//
// The dark style is *derived* from the app's style rather than duplicated: layer
// order, filters, source-layers and geometry all keep coming from mapStyle.js,
// and only the colour literals are swapped. Add a colour to mapStyle.js without
// a counterpart here and the server prints a warning at startup.
//
// Palette brief: deep slate charcoal canvas, muted blue-grey water, fine grey
// roads where the more important the road the darker it reads, and crisp
// white / light-grey typography.

const DARK_COLORS = {
  // terrain
  '#f8f4f0': '#191c21', // background — deep slate charcoal
  '#d8e8d0': '#1d2327', // landcover — barely-there green-grey
  '#e8e4df': '#1b1f24', // landuse — a shade off the canvas
  '#c8e6c0': '#1f2825', // park
  '#a3cce9': '#202e39', // water + waterway — muted blue-grey
  '#d9d0c9': '#23272e', // building blocks
  // roads — important reads darker, minor streets lighter
  '#c8c0b8': '#121419', // casing
  '#e892a2': '#24292f', // motorway
  '#f9b29c': '#272c33', // trunk
  '#fcd6a4': '#2b3038', // primary
  '#f7fabf': '#2f353d', // secondary
  '#ffffff': '#3a4149', // tertiary and below
  '#9e9cab': '#2f353d', // boundary
  // labels — halo is the background colour, so it always matches the canvas
  '#2d3436': '#ffffff', // city / town
  '#6b7280': '#aab3bf', // neighbourhoods
  '#7a828c': '#98a2ae', // street names
};

/** Fill layers whose light-mode opacity is too faint on a dark background. */
const DARK_OPACITY = { landcover: 0.85, landuse: 0.7, park: 0.85, building: 0.9 };

const unmappedColors = new Set();

const recolor = (value) => {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    const mapped = DARK_COLORS[value.toLowerCase()];
    if (!mapped) unmappedColors.add(value);
    return mapped ?? value;
  }
  if (Array.isArray(value)) return value.map(recolor);
  return value;
};

function buildDarkStyle(light) {
  const dark = structuredClone(light);
  dark.name = `${light.name ?? 'Offline'} (dark)`;
  for (const layer of dark.layers) {
    if (layer.paint) {
      layer.paint = Object.fromEntries(
        Object.entries(layer.paint).map(([key, value]) => [key, recolor(value)]),
      );
      if (layer.type === 'fill' && DARK_OPACITY[layer.id] != null) {
        layer.paint['fill-opacity'] = DARK_OPACITY[layer.id];
      }
    }
  }
  return dark;
}

// ----------------------------------------------------------------- labels
//
// Symbol layers are added here rather than in app/src/mapStyle.js because they
// need a glyph source, which only this viewer serves (locally, from vendor/fonts).
// Colours are written for the light theme and pass through DARK_COLORS above.

const FONT_STACK = 'Noto Sans Regular';
const LABEL_HALO = '#f8f4f0'; // = the light background, so it recolours to the dark one
const textField = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];

// MapLibre resolves label collisions by layer order: the *last* layer wins, so the
// stack below runs least- to most-important and the city name always survives.
// Sizes, casing and weight carry the hierarchy — two text colours only, which is
// what keeps the type looking crisp rather than busy.
const labelLayers = () => [
  {
    id: 'road-label',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    minzoom: 14,
    layout: {
      'text-field': textField,
      'text-font': [FONT_STACK],
      'symbol-placement': 'line',
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 12],
      'text-letter-spacing': 0.05,
      'text-padding': 4,
      'text-rotation-alignment': 'map',
      'symbol-sort-key': ['coalesce', ['get', 'ref_length'], 0],
    },
    paint: {
      'text-color': '#7a828c',
      'text-halo-color': LABEL_HALO,
      'text-halo-width': 1,
    },
  },
  {
    id: 'place-village',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 13,
    filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet']]],
    layout: {
      'text-field': textField,
      'text-font': [FONT_STACK],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 16, 11],
      'text-max-width': 6,
      'text-padding': 4,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': '#6b7280',
      'text-halo-color': LABEL_HALO,
      'text-halo-width': 1,
    },
  },
  {
    id: 'place-suburb',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 11,
    filter: [
      'in',
      ['get', 'class'],
      ['literal', ['suburb', 'borough', 'quarter', 'neighbourhood']],
    ],
    layout: {
      'text-field': textField,
      'text-font': [FONT_STACK],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.15,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 15, 11.5],
      'text-max-width': 7,
      'text-padding': 6,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': '#6b7280',
      'text-halo-color': LABEL_HALO,
      'text-halo-width': 1.2,
    },
  },
  {
    id: 'place-town',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 9,
    filter: ['in', ['get', 'class'], ['literal', ['town']]],
    layout: {
      'text-field': textField,
      'text-font': [FONT_STACK],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 14, 14],
      'text-max-width': 8,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': '#2d3436',
      'text-halo-color': LABEL_HALO,
      'text-halo-width': 1.3,
    },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 6,
    filter: ['in', ['get', 'class'], ['literal', ['city']]],
    layout: {
      'text-field': textField,
      'text-font': [FONT_STACK],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 15, 15, 17],
      'text-letter-spacing': 0.02,
      'text-max-width': 8,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': '#2d3436',
      'text-halo-color': LABEL_HALO,
      'text-halo-width': 1.5,
    },
  },
];

const withLabels = (style) => ({
  ...style,
  glyphs: '/fonts/{fontstack}/{range}.pbf',
  layers: [...style.layers, ...labelLayers()],
});

const lightStyle = withLabels(await loadAppStyle());
const styles = {
  '/style.json': lightStyle,
  '/style-dark.json': buildDarkStyle(lightStyle),
};

if (unmappedColors.size) {
  console.warn(
    `warning: no dark counterpart for ${[...unmappedColors].join(', ')} — ` +
      'add them to DARK_COLORS in server.mjs to extend the dark theme.',
  );
}

// ---------------------------------------------------------------- http

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pbf': 'application/x-protobuf',
};

const sendJson = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const sendFile = (res, filePath) => {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath).pipe(res);
  return true;
};

let tileHits = 0;
let tileMisses = 0;

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (styles[pathname]) return sendJson(res, styles[pathname]);
  if (pathname === '/tiles.json') return sendJson(res, tilejson);

  if (pathname === '/meta.json') {
    return sendJson(res, {
      mbtiles: mbtilesPath,
      sizeBytes: statSync(mbtilesPath).size,
      bounds,
      center,
      minzoom,
      maxzoom,
      tileCount: db.prepare('select count(*) as n from tiles').get().n,
      attribution: tilejson.attribution,
      planetiler: metadata.get('planetiler:version') ?? null,
      osmDataAsOf: metadata.get('planetiler:osm:osmosisreplicationtime') ?? null,
      tileHits,
      tileMisses,
    });
  }

  // Glyph PBFs for the symbol layers: /fonts/{fontstack}/{range}.pbf, served from
  // the vendored font in vendor/fonts so label rendering stays offline.
  const glyph = /^\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/.exec(pathname);
  if (glyph) {
    const fontstack = decodeURIComponent(glyph[1]);
    if (!/^[\w .-]+$/.test(fontstack)) {
      res.writeHead(400).end('bad fontstack');
      return;
    }
    if (!sendFile(res, join(FONTS_DIR, fontstack, `${glyph[2]}.pbf`))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    return;
  }

  const tile = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(pathname);
  if (tile) {
    const [z, x, y] = tile.slice(1).map(Number);
    if (z > 24 || x >= 2 ** z || y >= 2 ** z) {
      res.writeHead(404).end('tile out of range');
      return;
    }
    // mbtiles rows are TMS (origin bottom-left); the URL scheme is XYZ.
    const tmsY = 2 ** z - 1 - y;
    const row = tileQuery.get(z, x, tmsY);
    if (!row) {
      tileMisses++;
      if (verbose) console.log(`  miss  z${z} ${x}/${y}`);
      // 204 tells MapLibre "this tile is intentionally empty".
      res.writeHead(204).end();
      return;
    }
    tileHits++;
    if (verbose) console.log(`  tile  z${z} ${x}/${y} (${row.tile_data.byteLength} B)`);
    const body = Buffer.from(row.tile_data);
    const gzipped = body[0] === 0x1f && body[1] === 0x8b;
    res.writeHead(200, {
      'Content-Type': 'application/x-protobuf',
      'Content-Length': body.byteLength,
      ...(gzipped ? { 'Content-Encoding': 'gzip' } : {}),
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(body);
    return;
  }

  // Static assets: /vendor/* from the vendored MapLibre build, everything else
  // from public/. Normalise and reject ".." so neither directory can be escaped.
  const parts = normalize(decodeURIComponent(pathname))
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.');

  const isVendor = parts[0] === 'vendor';
  const base = isVendor ? VENDOR_DIR : PUBLIC_DIR;
  const relative = isVendor ? parts.slice(1) : parts;
  const filePath = join(base, ...(relative.length ? relative : ['index.html']));

  const insideBase = filePath.startsWith(base + sep);
  if (!insideBase || relative.includes('..') || !sendFile(res, filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

// ---------------------------------------------------------------- start

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) return listen(port + 1, attempt + 1);
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    const mb = (statSync(mbtilesPath).size / 1024 / 1024).toFixed(1);
    console.log('Nomad — Kampala offline map');
    console.log(`  tiles : ${mbtilesPath} (${mb} MB, z${minzoom}-${maxzoom})`);
    console.log(`  style : app/src/mapStyle.js (light + dark, rendered in MapLibre GL JS)`);
    console.log(`  open  : ${url}`);
    console.log('  stop  : Ctrl+C');
    if (shouldOpen) openBrowser(url);
  });
}

function openBrowser(url) {
  const [cmd, argv] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, argv, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}

listen(startPort);
