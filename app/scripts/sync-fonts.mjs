// Copies the offline glyph (font) PBFs into the app's static files.
//
// MapLibre draws every text label from a glyph PBF referenced by the style's
// `glyphs` URL template. The app must never fetch them over the network, so the
// same PBFs are shipped twice from one source of truth:
//
//   assets/fonts/<stack>/<range>.pbf  bundled into the native app (expo-asset)
//   public/fonts/<stack>/<range>.pbf  served statically to the browser build
//
// `assets/` is the tracked copy; `public/fonts/` is generated here and runs on
// `postinstall` and before every web build, mirroring sync-maplibre-worker.mjs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(appRoot, 'assets', 'fonts');
const targetRoot = join(appRoot, 'public', 'fonts');

let copied = 0;
let reused = 0;

for (const stack of readdirSync(sourceRoot)) {
  const stackDir = join(sourceRoot, stack);
  for (const file of readdirSync(stackDir)) {
    if (!file.endsWith('.pbf')) continue;
    const source = join(stackDir, file);
    const target = join(targetRoot, stack, file);
    mkdirSync(dirname(target), { recursive: true });
    const upToDate =
      existsSync(target) && readFileSync(source).equals(readFileSync(target));
    if (upToDate) {
      reused += 1;
    } else {
      copyFileSync(source, target);
      copied += 1;
    }
  }
}

console.log(`[map-fonts] ${copied} copied, ${reused} up to date -> ${targetRoot}`);
