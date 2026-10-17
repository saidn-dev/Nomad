// The dropped pin, described once so both map engines draw the same thing.
//
// NomadMap.js (maplibre-react-native) and NomadMap.web.js (maplibre-gl JS)
// render it as a circle layer over a GeoJSON source. That is geometry on the
// GPU, which matters: the previous pin was a Marker, which on native is a real
// React Native view floated over the map. Every pan frame had to be pushed
// across the JS bridge to re-aim that view, so dragging the map stuttered and
// dropping a pin waited on a view re-mount. A circle layer rides the camera
// for free, and a tap only rewrites one feature.

export const PIN_SOURCE_ID = 'pin-source';
export const PIN_LAYER_ID = 'pin-layer';

// Ring in the map's own background colour (#191c21 in dark mode) rather than
// white: it separates the dot from roads and labels underneath without ever
// competing with the white street text.
export const PIN_PAINT = {
  'circle-color': '#00ffff',
  'circle-radius': 6,
  'circle-stroke-width': 3,
  'circle-stroke-color': '#191c21',
};

export const EMPTY_PIN = { type: 'FeatureCollection', features: [] };

/**
 * `pin` is [lng, lat], the pair the app has always spoken. Nothing dropped
 * gives back an empty FeatureCollection rather than null, so the source stays
 * mounted — showing the first pin is then a data swap, not a source mount in
 * the middle of an animation.
 */
export function pinData(pin) {
  if (!pin) return EMPTY_PIN;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pin },
        properties: {},
      },
    ],
  };
}
