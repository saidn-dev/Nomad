// Dark palette, ported from tools/browser-map/server.mjs so the app and the
// browser viewer share the exact same colours. Palette brief: deep slate
// charcoal canvas, muted blue-grey water, fine grey roads where the more
// important the road the darker it reads.
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
};

/** Fill layers whose light-mode opacity is too faint on a dark background. */
const DARK_OPACITY = { landcover: 0.85, landuse: 0.7, park: 0.85, building: 0.9 };

/** Swap colour literals, recursing into data-driven expressions (match/interpolate). */
const recolor = (value) => {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    return DARK_COLORS[value.toLowerCase()] ?? value;
  }
  if (Array.isArray(value)) return value.map(recolor);
  return value;
};

export function buildKampalaStyle(mbtilesUrl, { dark = false } = {}) {
  const roadFilter = [
    'in',
    'class',
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'minor',
    'service',
    'street',
    'street_limited',
  ];

  const style = {
    version: 8,
    name: dark ? 'Kampala Offline (dark)' : 'Kampala Offline',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: mbtilesUrl,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f8f4f0' },
      },
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#d8e8d0', 'fill-opacity': 0.6 },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#e8e4df', 'fill-opacity': 0.5 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': '#c8e6c0', 'fill-opacity': 0.5 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#a3cce9' },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: { 'line-color': '#a3cce9', 'line-width': 1 },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': '#d9d0c9', 'fill-opacity': 0.7 },
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: roadFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c8c0b8',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            1,
            14,
            4,
            18,
            12,
          ],
        },
      },
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: roadFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway',
            '#e892a2',
            'trunk',
            '#f9b29c',
            'primary',
            '#fcd6a4',
            'secondary',
            '#f7fabf',
            '#ffffff',
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            0.6,
            14,
            2.5,
            18,
            9,
          ],
        },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 6],
        paint: {
          'line-color': '#9e9cab',
          'line-width': 1,
          'line-dasharray': [2, 2],
        },
      },
    ],
  };

  if (!dark) return style;

  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (!layer.paint) return layer;
      const paint = Object.fromEntries(
        Object.entries(layer.paint).map(([key, value]) => [key, recolor(value)]),
      );
      if (layer.type === 'fill' && DARK_OPACITY[layer.id] != null) {
        paint['fill-opacity'] = DARK_OPACITY[layer.id];
      }
      return { ...layer, paint };
    }),
  };
}
