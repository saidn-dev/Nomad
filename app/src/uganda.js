// Where the camera is allowed to be.
//
// Nomad only ships tiles for Uganda (nationwide at the low zooms, Kampala in
// detail), so the map is clamped to the country rather than letting the user
// wander onto empty canvas or the rest of the world.

/**
 * The country box, as [west, south, east, north].
 *
 * Deliberately a little wider than Uganda's legal borders so the outline is not
 * jammed against the screen edge, and matched to the `--bounds` passed to
 * Planetiler when the tiles were built.
 */
export const UGANDA_BOUNDS = [29.5, -1.5, 35.1, 4.3];

/** Zoom ceiling. The tiles stop at z15, so one extra level of overzoom. */
export const MAP_MAX_ZOOM = 16;

/**
 * Web-Mercator Y for a latitude, normalised so the top of the world is 0.
 * This is the projection the tiles are cut in, so it is the right space to
 * measure the country in.
 */
function mercatorY(latitude) {
  const sin = Math.sin((latitude * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/**
 * The smallest zoom at which Uganda still covers the whole viewport.
 *
 * Below this you would see past the country's edge, and there are no tiles out
 * there — so this doubles as the zoom-out limit. It depends on how big the
 * viewport is (a laptop window is wider, a phone taller), which is why it is
 * computed rather than hard-coded.
 *
 * @param {number} width  viewport width in CSS pixels
 * @param {number} height viewport height in CSS pixels
 */
export function coverZoom(width, height) {
  // A container that has not been laid out yet reports zero. Fall back to no
  // limit rather than the ceiling: the resize callback that follows will apply
  // the real one, and a momentarily-looser limit is far less annoying than a
  // map stuck at maximum zoom.
  if (!(width > 0) || !(height > 0)) return 0;
  // MapLibre measures the world as 512 px per tile.
  const WORLD_TILE = 512;
  const [west, south, east, north] = UGANDA_BOUNDS;
  // The country's span as a fraction of the whole world.
  const lngSpan = (east - west) / 360;
  const latSpan = mercatorY(south) - mercatorY(north);
  const zoomForWidth = Math.log2(width / (WORLD_TILE * lngSpan));
  const zoomForHeight = Math.log2(height / (WORLD_TILE * latSpan));
  // The stricter of the two: whichever edge would show first sets the limit.
  return Math.max(zoomForWidth, zoomForHeight);
}
