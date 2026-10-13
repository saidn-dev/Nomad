#!/usr/bin/env node
/**
 * Downloads the glyph PBFs the label layers need into `vendor/fonts/`.
 *
 * Run once when setting up the viewer (or when adding a fontstack/range):
 *
 *   node tools/browser-map/fetch-fonts.mjs
 *
 * This is the only step that touches the network. The server reads the files from
 * disk afterwards, so rendering labels offline needs no further downloads.
 *
 * Source: the MapLibre demo tile server, which serves glyphs generated from
 * Noto Sans (SIL Open Font License 1.1).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const BASE = 'https://demotiles.maplibre.org/font/';

// One fontstack keeps the type minimal; the ranges cover everything the Kampala
// labels actually use:
//   0-255      ASCII / Latin-1
//   256-511    Latin Extended-A (Luganda ŋ, and friends)
//   8192-8447  General Punctuation (curly quotes and dashes in OSM names)
const STACKS = {
  'Noto Sans Regular': ['0-255', '256-511', '8192-8447'],
};

let failed = 0;
for (const [stack, ranges] of Object.entries(STACKS)) {
  const dir = join(ROOT, 'vendor', 'fonts', stack);
  mkdirSync(dir, { recursive: true });
  for (const range of ranges) {
    const url = `${BASE}${encodeURIComponent(stack)}/${range}.pbf`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ${res.status} ${url}`);
      failed++;
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 512) {
      console.error(`  suspiciously small (${bytes.length}B) ${url}`);
      failed++;
      continue;
    }
    writeFileSync(join(dir, `${range}.pbf`), bytes);
    console.log(`  ${stack}/${range}.pbf  ${bytes.length}B`);
  }
}

if (failed) {
  console.error(`\n${failed} range(s) failed — check your connection and re-run.`);
  process.exit(1);
}
console.log(`\nGlyphs written to ${join('vendor', 'fonts')}. The viewer is offline from here on.`);
