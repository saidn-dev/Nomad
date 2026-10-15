// Copies MapLibre's web worker into the app's static files.
//
// MapLibre GL JS resolves its tile-parsing worker at runtime via
// `import.meta.url` -> `new URL('./maplibre-gl-worker.mjs', <bundle url>)`.
// Metro cannot bundle a runtime-resolved worker, so we serve it as a static
// file from `public/` (which Expo also copies into the exported site) and point
// MapLibre at it with `setWorkerUrl` (see src/NomadMap.web.js).
//
// The file must match the installed maplibre-gl version, so it is regenerated
// here and this script runs on `postinstall` and before every `npm run web`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const source = require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs');
const target = join(appRoot, 'public', 'maplibre-gl-worker.mjs');

mkdirSync(dirname(target), { recursive: true });

const upToDate = existsSync(target) && readFileSync(target).equals(readFileSync(source));
if (upToDate) {
  console.log('[maplibre-worker] up to date');
} else {
  copyFileSync(source, target);
  console.log(`[maplibre-worker] copied to ${target}`);
}
