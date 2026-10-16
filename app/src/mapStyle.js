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
  // labels — the halo is what keeps text legible over roads and water
  '#3c3c3c': '#cdd4de', // city and suburb labels — the brightest text
  '#5c5c5c': '#8b95a5', // street names and POIs — one step down
  '#757575': '#79828f', // villages — dimmest, so they recede behind real detail
  '#fafafa': '#12151a', // label halo — darker than the canvas so text pops
  // POI text is the one place colour carries meaning (category), so these are
  // the only non-greyscale entries. Kept muted so a dense z15 view stays calm.
  '#d63b3b': '#e0a0a0', // health — hospital, clinic, pharmacy
  '#3b6bd6': '#9db6e8', // education — school, college, university, library
  '#6b4fd6': '#b3a3e6', // civic — town hall, police, courthouse, post
  '#1f9e8f': '#8ad0c4', // transit — bus, rail, ferry, taxi
  '#b9791f': '#dcc08b', // commerce — shop, bank, office, marketplace
  '#c25b2b': '#e0ab8b', // food — restaurant, cafe, bar
  '#a34fd6': '#d0b3e8', // lodging — hotel, hostel, guest house
  '#7a6f4f': '#c3bda6', // worship
  '#4b5563': '#9aa4b1', // fuel and charging
};

/** Fill layers whose light-mode opacity is too faint on a dark background. */
const DARK_OPACITY = { landcover: 0.85, landuse: 0.7, park: 0.85, building: 0.9 };

// Names arrive under several keys depending on the extract and the tile build;
// prefer an English/Latin spelling and fall back to the local one. A POI or road
// with none of these evaluates to null, and MapLibre simply skips the label.
const NAME = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name_en'],
  ['get', 'name:latin'],
  ['get', 'name'],
];

/** Passes only features that carry a usable name, so unlabelled symbols are dropped early. */
const HAS_NAME = [
  'any',
  ['has', 'name'],
  ['has', 'name:en'],
  ['has', 'name_en'],
  ['has', 'name:latin'],
];

/**
 * POI categories collapsed into a handful of buckets. Anything unmatched falls
 * through to the generic grey at the end of the expression.
 */
const POI_CATEGORY = [
  'match',
  ['get', 'class'],
  ['hospital', 'clinic', 'pharmacy', 'doctors', 'dentist', 'veterinary'],
  '#d63b3b',
  ['school', 'college', 'university', 'library', 'kindergarten'],
  '#3b6bd6',
  ['town_hall', 'courthouse', 'police', 'fire_station', 'post', 'embassy', 'government'],
  '#6b4fd6',
  ['bus', 'rail', 'tram', 'ferry', 'taxi', 'bicycle', 'aerodrome'],
  '#1f9e8f',
  ['shop', 'supermarket', 'mall', 'bank', 'atm', 'office', 'marketplace'],
  '#b9791f',
  ['restaurant', 'cafe', 'bar', 'fast_food', 'pub'],
  '#c25b2b',
  ['lodging', 'hotel', 'hostel', 'guest_house', 'motel', 'camp_site'],
  '#a34fd6',
  ['place_of_worship'],
  '#7a6f4f',
  ['fuel', 'charging_station'],
  '#4b5563',
  '#5c5c5c',
];

/** Swap colour literals, recursing into data-driven expressions (match/interpolate). */
const recolor = (value) => {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    return DARK_COLORS[value.toLowerCase()] ?? value;
  }
  if (Array.isArray(value)) return value.map(recolor);
  return value;
};

/** Road classes that earn the larger, earlier "this is how you get there" label. */
const MAJOR_ROAD_CLASSES = [
  'motorway',
  'motorway_construction',
  'trunk',
  'trunk_construction',
  'primary',
  'primary_construction',
  'secondary',
  'secondary_construction',
];

/** Line classes that are never worth a street label at city zooms. */
const UNLABELLED_ROAD_CLASSES = ['path', 'footway', 'pedestrian', 'steps', 'service'];

/**
 * Text layers, listed in *ascending* collision priority.
 *
 * MapLibre works out where labels fit by walking the symbol layers from the
 * last one in the style back to the first, so a label from a later layer wins
 * any overlap. Read this list bottom-up to get the priority order: a city name
 * beats a road name, which beats a shop name.
 *
 * The ordering is load-bearing, not cosmetic. OSM has a village point on what
 * feels like every block in Kampala — around 16,000 named villages land in the
 * z15 tiles alone — so villages are given the *lowest* priority on purpose.
 * Collision culling then keeps only as many as the map has room for: dense
 * where the map is empty, almost absent where streets and shops already fill
 * it. Cities and suburbs are few enough to deserve a guaranteed slot.
 *
 * The two road layers are deliberately disjoint — major classes in one,
 * everything else in the other — rather than two overlapping views of the same
 * roads. Two symbol layers labelling the same road would fight over a single
 * collision box and only the topmost would ever appear.
 */
const LABEL_LAYERS = [
  {
    // Villages, hamlets and small islands. Deliberately last in priority: they
    // are the map's filler, carrying rural areas where nothing else exists and
    // quietly disappearing wherever the streets and shops get dense.
    id: 'place-label-village',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 11,
    filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'island']]],
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansRegular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 14, 11, 17, 13],
      'text-max-width': 8,
      // A wider collision box than the other labels, to thin them out further.
      'text-padding': 6,
      'text-anchor': 'center',
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 999],
    },
    paint: {
      'text-color': '#757575',
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.1,
    },
  },
  {
    // Points of interest, text only — no sprite icons yet, so the category is
    // carried entirely by colour.
    id: 'poi-label',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom: 13,
    filter: HAS_NAME,
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansRegular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12, 19, 14],
      'text-max-width': 9,
      'text-padding': 4,
      'text-anchor': 'center',
      // poi.rank is an importance tier (1 = hospitals, colleges, town halls),
      // so the important ones place before the corner shop.
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: {
      'text-color': POI_CATEGORY,
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.1,
    },
  },
  {
    // Every named street that is not a major road, once you are zoomed in far
    // enough for the small ones to be telling rather than noise.
    id: 'road-label-minor',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    minzoom: 14,
    filter: [
      'all',
      ['!', ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]]],
      ['!', ['in', ['get', 'class'], ['literal', UNLABELLED_ROAD_CLASSES]]],
      ['!=', ['get', 'subclass'], 'path'],
      ['!=', ['get', 'subclass'], 'footway'],
      HAS_NAME,
    ],
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansRegular'],
      'symbol-placement': 'line',
      'symbol-spacing': 300,
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12],
      'text-max-angle': 30,
      'text-padding': 4,
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': '#5c5c5c',
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.2,
    },
  },
  {
    // The network you navigate by — readable from z12 and set a size larger so
    // the road hierarchy survives at every zoom.
    id: 'road-label-major',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    minzoom: 12,
    filter: ['all', ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]], HAS_NAME],
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansRegular'],
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
      'text-max-angle': 30,
      'text-padding': 4,
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': '#5c5c5c',
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.3,
    },
  },
  {
    // Suburbs and neighbourhoods — the parts of a city people actually name.
    // (Villages are a separate, lower-priority layer; see the note above.)
    id: 'place-label-local',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 11,
    filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood']]],
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansRegular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13, 17, 16],
      'text-max-width': 9,
      'text-padding': 3,
      'text-anchor': 'center',
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 999],
    },
    paint: {
      'text-color': '#5c5c5c',
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.2,
    },
  },
  {
    // Cities and towns, from the low zooms up — the "where am I" anchor, and
    // the name that matters most when two labels collide.
    id: 'place-label-city',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 3,
    filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
    layout: {
      'text-field': NAME,
      'text-font': ['NotoSansBold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 10, 15, 14, 22, 17, 28],
      'text-max-width': 8,
      'text-padding': 4,
      'text-anchor': 'center',
      // place.rank is a dense importance index (lower = more important), so the
      // important places place before the obscure ones.
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 999],
    },
    paint: {
      'text-color': '#3c3c3c',
      'text-halo-color': '#fafafa',
      'text-halo-width': 1.4,
    },
  },
];

export function buildKampalaStyle(tileUrl, { dark = false, glyphs = null } = {}) {
  // Every text layer needs a glyph source; without one MapLibre rejects the
  // style, so the label layers are only added once `glyphs` has been resolved.
  const labelLayers = glyphs ? LABEL_LAYERS : [];

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
    // Only present once the glyph PBFs are resolvable; MapLibre rejects a style
    // whose `glyphs` is null.
    ...(glyphs ? { glyphs } : {}),
    sources: {
      openmaptiles: {
        type: 'vector',
        url: tileUrl,
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
      // Labels sit last so they draw over the roads and areas they name.
      ...labelLayers,
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
