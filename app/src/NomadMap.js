// Native (Android / iOS) implementation of the shared map surface.
//
// App.js imports './src/NomadMap' by name only. The bundler resolves this file
// for native builds and NomadMap.web.js for the browser, so the same app code
// renders on both. Only the engine differs here: maplibre-react-native.
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { MAP_MAX_ZOOM, UGANDA_BOUNDS, coverZoom } from './uganda';

export default function NomadMap({ style, mapStyle, center, zoom, pin, pinContent, onPress }) {
  // The map fills the window, so the window is the viewport. Recomputing on
  // rotation or split-screen keeps the zoom-out limit in step with the space
  // the country actually has to fill.
  const { width, height } = useWindowDimensions();
  const minZoom = useMemo(() => coverZoom(width, height), [width, height]);

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
      {pin && pinContent ? <Marker lngLat={pin}>{pinContent}</Marker> : null}
    </Map>
  );
}
