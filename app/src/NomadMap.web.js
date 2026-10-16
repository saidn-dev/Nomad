// Browser implementation of the shared map surface.
//
// Same name, same props as NomadMap.js — App.js cannot tell them apart. The
// engine is MapLibre GL JS instead of maplibre-react-native, because the native
// module has no web build. This is the *only* place the two platforms diverge.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Map as MapLibreMap, Marker, addProtocol, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';

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

export default function NomadMap({ mapStyle, center, zoom, pin, pinContent, onPress }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pinElRef = useRef(null);
  const pinRootRef = useRef(null);
  const markerRef = useRef(null);
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

    const pinEl = document.createElement('div');
    pinElRef.current = pinEl;
    pinRootRef.current = createRoot(pinEl);
    mapRef.current = map;
    // Escape hatch for the devtools console and design checks.
    if (typeof window !== 'undefined') window.__nomadMap = map;

    return () => {
      pinRootRef.current?.unmount();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      pinElRef.current = null;
      pinRootRef.current = null;
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

  // Render the pin with the app's own React element, so a style tweak in
  // App.js is reflected here too.
  useEffect(() => {
    pinRootRef.current?.render(pinContent);
  }, [pinContent]);

  // Show / move / hide the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinElRef.current) return;
    if (!pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) {
      markerRef.current.setLngLat(pin);
      return;
    }
    markerRef.current = new Marker({ element: pinElRef.current, anchor: 'center' })
      .setLngLat(pin)
      .addTo(map);
  }, [pin]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />;
}
