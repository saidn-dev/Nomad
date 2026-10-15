// Browser offline tiles: PMTiles, a single static archive the browser reads with
// HTTP range requests. It lives at the site root (app/public/city.pmtiles), so
// the dev server and the exported site both serve it with no tile server.
const PMTILES_FILE = 'city.pmtiles';

export function useOfflineTiles() {
  // Resolve against the document base so the site still works when it is hosted
  // under a sub-path (e.g. GitHub Pages project sites).
  const base = typeof document === 'undefined' ? '' : document.baseURI;
  const url = typeof window === 'undefined' ? PMTILES_FILE : new URL(PMTILES_FILE, base).href;
  return { ready: true, error: null, tileUrl: `pmtiles://${url}` };
}
