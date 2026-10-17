// Browser implementation of the shared map surface.
//
// Same name, same props as NomadMap.js — App.js cannot tell them apart. The
// engine is MapLibre GL JS instead of maplibre-react-native, because the native
// module has no web build. This is the *only* place the two platforms diverge.
import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_MAX_ZOOM, UGANDA_BOUNDS, coverZoom } from './uganda';
import { EMPTY_PIN, PIN_LAYER_ID, PIN_PAINT, PIN_SOURCE_ID, pinData } from './pin';

// The pmtiles:// scheme reads the offline archive straight from the static site
// with HTTP range requests — no tile server required.
addProtocol('pmtiles', new Protocol().tile);

// MapLibre loads its tile-parsing worker from a URL relative to the bundle,
// which Metro cannot provide. Point it at the static copy in public/ instead
// (kept in sync by scripts/sync-maplibre-worker.mjs).
if (typeof document !== 'undefined') {
  const workerUrl = new URL('maplibre-gl-worker.mjs', document.baseURI).href;
  setWorkerUrl(workerUrl);
  window.__nomadWorkerUrl = workerUrl;
}

// The pin is a circle layer here for the same reason it is on device: it is
// drawn by the render engine, not tracked as a DOM marker. `setStyle` throws
// away everything added at runtime, so the source is re-created whenever it is
// missing rather than assumed to still be there.
function applyPinLayer(map, pin) {
  if (!map.getSource(PIN_SOURCE_ID)) {
    map.addSource(PIN_SOURCE_ID, { type: 'geojson', data: EMPTY_PIN });
    map.addLayer({
      id: PIN_LAYER_ID,
      type: 'circle',
      source: PIN_SOURCE_ID,
      paint: PIN_PAINT,
    });
  }
  map.getSource(PIN_SOURCE_ID).setData(pinData(pin));
}

export default function NomadMap({ mapStyle, center, zoom, pin, onPress }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  // Create the map once. `center` / `zoom` / `mapStyle` seed the view, mirroring
  // the app's <Camera initialViewState> rather than tracking later changes.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: mapStyle,
      center,
      zoom,
      attributionControl: false,
    });
    // MapLibre reports lngLat as an object; the app speaks [lng, lat].
    map.on('click', (event) => onPressRef.current?.([event.lngLat.lng, event.lngLat.lat]));
    mapRef.current = map;
    // Escape hatch for the devtools console and design checks.
    if (typeof window !== 'undefined') window.__nomadMap = map;

    // Keep the camera over Uganda. There are no tiles outside the country, so
    // panning is bounded and the zoom-out limit is the point at which the
    // viewport would start to show beyond the border. Because that limit
    // depends on the viewport, it is recomputed whenever the window resizes.
    const [west, south, east, north] = UGANDA_BOUNDS;
    map.setMaxBounds([
      [west, south],
      [east, north],
    ]);
    map.setMaxZoom(MAP_MAX_ZOOM);
    map.setRenderWorldCopies(false);

    const applyZoomLimit = () => {
      const el = containerRef.current;
      if (el) map.setMinZoom(coverZoom(el.clientWidth, el.clientHeight));
    };
    applyZoomLimit();
    const resizeObserver = new ResizeObserver(applyZoomLimit);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the style in place when it is rebuilt (keeps camera + pin).
  const appliedStyleRef = useRef(mapStyle);
  useEffect(() => {
    if (appliedStyleRef.current === mapStyle) return;
    appliedStyleRef.current = mapStyle;
    mapRef.current?.setStyle(mapStyle);
  }, [mapStyle]);

  // Show / move / hide the pin. Depending on `mapStyle` as well as `pin` so the
  // layer is rebuilt immediately after a setStyle drops it.
  useEffect(() => {
    if (mapRef.current) applyPinLayer(mapRef.current, pin);
  }, [pin, mapStyle]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />;
}
