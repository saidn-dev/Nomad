// Native (Android / iOS) implementation of the shared map surface.
//
// App.js imports './src/NomadMap' by name only. The bundler resolves this file
// for native builds and NomadMap.web.js for the browser, so the same app code
// renders on both. Only the engine differs here: maplibre-react-native.
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { MAP_MAX_ZOOM, UGANDA_BOUNDS, coverZoom } from './uganda';
import { PIN_LAYER_ID, PIN_PAINT, PIN_SOURCE_ID, pinData } from './pin';

export default function NomadMap({ style, mapStyle, center, zoom, pin, onPress }) {
  // The map fills the window, so the window is the viewport. Recomputing on
  // rotation or split-screen keeps the zoom-out limit in step with the space
  // the country actually has to fill.
  const { width, height } = useWindowDimensions();
  const minZoom = useMemo(() => coverZoom(width, height), [width, height]);

  // Dropped as GeoJSON rather than a <Marker>. A Marker is a native view
  // re-anchored across the JS bridge on every frame it is on screen, which
  // made panning visibly stutter. A circle layer is drawn by the render engine
  // itself, so it tracks the camera without ever involving React.
  const data = useMemo(() => pinData(pin), [pin]);

  return (
    <Map
      style={style}
      mapStyle={mapStyle}
      onPress={(event) => onPress?.(event.nativeEvent.lngLat)}
    >
      <Camera
        initialViewState={{ center, zoom }}
        minZoom={minZoom}
        maxZoom={MAP_MAX_ZOOM}
        maxBounds={UGANDA_BOUNDS}
      />
      <GeoJSONSource id={PIN_SOURCE_ID} data={data}>
        {/* Appended after the style's own layers, so the pin always draws on top. */}
        <Layer id={PIN_LAYER_ID} type="circle" paint={PIN_PAINT} />
      </GeoJSONSource>
    </Map>
  );
}
