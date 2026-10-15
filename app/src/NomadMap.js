// Native (Android / iOS) implementation of the shared map surface.
//
// App.js imports './src/NomadMap' by name only. The bundler resolves this file
// for native builds and NomadMap.web.js for the browser, so the same app code
// renders on both. Only the engine differs here: maplibre-react-native.
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';

export default function NomadMap({ style, mapStyle, center, zoom, pin, pinContent, onPress }) {
  return (
    <Map
      style={style}
      mapStyle={mapStyle}
      onPress={(event) => onPress?.(event.nativeEvent.lngLat)}
    >
      <Camera initialViewState={{ center, zoom }} />
      {pin && pinContent ? <Marker lngLat={pin}>{pinContent}</Marker> : null}
    </Map>
  );
}
