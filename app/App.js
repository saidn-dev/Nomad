import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAssets } from 'expo-asset';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { buildKampalaStyle } from './src/mapStyle';

const KAMPALA = [32.5825, 0.3476];

export default function App() {
  const [assets, error] = useAssets([require('./assets/city.mbtiles')]);
  const [pin, setPin] = useState(null);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Failed to load offline map: {error.message}</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!assets?.[0]?.localUri) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Loading offline map…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  const mapStyle = buildKampalaStyle(
    assets[0].localUri.replace('file://', 'mbtiles://'),
  );

  const onPress = (event) => {
    const { lngLat } = event.nativeEvent;
    setPin(lngLat);
  };

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={mapStyle} onPress={onPress}>
        <Camera initialViewState={{ center: KAMPALA, zoom: 12 }} />
        {pin ? (
          <Marker lngLat={pin}>
            <View style={styles.pin} />
          </Marker>
        ) : null}
      </Map>

      <View style={styles.hud}>
        <Text style={styles.coord}>
          {pin
            ? `${pin[1].toFixed(5)}, ${pin[0].toFixed(5)}`
            : 'Tap the map to drop a pin'}
        </Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, styles.btnRequest]}>
            <Text style={styles.btnText}>Request</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnAccept]}>
            <Text style={styles.btnText}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  hint: {
    fontSize: 16,
    color: '#333',
  },
  map: {
    flex: 1,
  },
  pin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#d63031',
    borderWidth: 2,
    borderColor: '#fff',
  },
  hud: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  coord: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnRequest: {
    backgroundColor: '#0984e3',
  },
  btnAccept: {
    backgroundColor: '#00b894',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
