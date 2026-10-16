// Browser offline glyphs (fonts). Labels are drawn from glyph PBFs, one file per
// 256-codepoint range, that the style's `glyphs` URL template points at.
//
// The PBFs are copied into app/public/fonts/ by scripts/sync-fonts.mjs, so the
// dev server and the exported site both serve them as plain static files.
const TEMPLATE = 'fonts/{fontstack}/{range}.pbf';

export function useGlyphs() {
  // Resolve against the document base so the site still works when it is hosted
  // under a sub-path (e.g. GitHub Pages project sites).
  //
  // Note: this deliberately does NOT go through `new URL(TEMPLATE, base)` — the
  // URL parser percent-encodes `{` and `}`, which would leave MapLibre with
  // `%7Bfontstack%7D` and no placeholder left to substitute.
  const base =
    typeof document === 'undefined' ? '/' : new URL('.', document.baseURI).href;
  const glyphs = typeof window === 'undefined' ? TEMPLATE : `${base}${TEMPLATE}`;
  return { ready: true, error: null, glyphs };
}
