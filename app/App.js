import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import NomadMap from './src/NomadMap';
import { useOfflineTiles } from './src/useOfflineTiles';
import { useGlyphs } from './src/glyphs';
import { buildKampalaStyle } from './src/mapStyle';

const KAMPALA = [32.5825, 0.3476];

// Brand accent colour — midnight blue.
const ACCENT = '#191970';

export default function App() {
  // Everything platform-specific lives behind these three imports: the map
  // engine, where the offline tiles come from, and where the offline label
  // glyphs come from. This file runs unchanged on device and in the browser.
  const tiles = useOfflineTiles();
  const fonts = useGlyphs();
  const ready = tiles.ready && fonts.ready;
  const error = tiles.error ?? fonts.error;
  const [pin, setPin] = useState(null);

  const mapStyle = useMemo(
    () => buildKampalaStyle(tiles.tileUrl, { dark: true, glyphs: fonts.glyphs }),
    [tiles.tileUrl, fonts.glyphs],
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Failed to load offline map: {error.message}</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Loading offline map…</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NomadMap
        style={styles.map}
        mapStyle={mapStyle}
        center={KAMPALA}
        zoom={12}
        pin={pin}
        pinContent={<View style={styles.pin} />}
        onPress={setPin}
      />

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

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#191c21',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#191c21',
  },
  hint: {
    fontSize: 16,
    color: '#e6e9ee',
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
    backgroundColor: 'rgba(20,22,27,0.95)',
  },
  coord: {
    fontSize: 14,
    color: '#e6e9ee',
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
    backgroundColor: ACCENT,
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
