// Native offline tiles: the archive is bundled inside the app, and MapLibre's
// mbtiles:// scheme reads it directly from the device file system.
import { useAssets } from 'expo-asset';

export function useOfflineTiles() {
  const [assets, error] = useAssets([require('../assets/city.mbtiles')]);
  const uri = assets?.[0]?.localUri;

  if (error) return { ready: false, error, tileUrl: null };
  if (!uri) return { ready: false, error: null, tileUrl: null };
  return { ready: true, error: null, tileUrl: uri.replace('file://', 'mbtiles://') };
}
