// Native offline glyphs (fonts). Labels are drawn from glyph PBFs, one file per
// 256-codepoint range, that the style's `glyphs` URL template points at.
//
// The PBFs ship inside the app bundle, but MapLibre Native needs to read them
// from real files at a predictable path — expo-asset hands out hashed flat
// filenames, so the four files are copied once into
// `<documents>/fonts/<fontstack>/<range>.pbf` and the template points there.
import { useEffect, useState } from 'react';
import { useAssets } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

// Font stacks are space-free on purpose: the same string is both the style's
// `text-font` value and the on-disk directory name, so the substituted URL never
// contains a character that has to be escaped on the way to the file system.
//
// Ranges are 256-codepoint blocks. Which ones are worth shipping was decided
// from the tiles themselves (see PLAN.md): 0-255 is Basic Latin/Latin-1,
// 256-511 is Latin Extended-A, and 8192-8447 is General Punctuation — that last
// one is not optional, because OSM road names are full of the typographic
// apostrophe and en dash rather than their ASCII equivalents.
const FILES = [
  ['NotoSansRegular', '0-255'],
  ['NotoSansRegular', '256-511'],
  ['NotoSansRegular', '8192-8447'],
  ['NotoSansBold', '0-255'],
  ['NotoSansBold', '256-511'],
  ['NotoSansBold', '8192-8447'],
];

// `require` has to be static, so the assets are listed in the same order as FILES.
const ASSETS = [
  require('../assets/fonts/NotoSansRegular/0-255.pbf'),
  require('../assets/fonts/NotoSansRegular/256-511.pbf'),
  require('../assets/fonts/NotoSansRegular/8192-8447.pbf'),
  require('../assets/fonts/NotoSansBold/0-255.pbf'),
  require('../assets/fonts/NotoSansBold/256-511.pbf'),
  require('../assets/fonts/NotoSansBold/8192-8447.pbf'),
];

const IDLE = { ready: false, error: null, glyphs: null };

/**
 * Copies the bundled glyph PBFs into documents/fonts and returns the `glyphs`
 * URL template, or null while the assets are still being unpacked.
 */
async function installGlyphs(assets) {
  const root = new Directory(Paths.document, 'fonts');
  if (!root.exists) root.create();

  assets.forEach((asset, index) => {
    const [stack, range] = FILES[index];
    const stackDir = new Directory(root, stack);
    if (!stackDir.exists) stackDir.create();

    const source = new File(asset.localUri);
    const destination = new File(root, stack, `${range}.pbf`);
    // Re-copy only when the copy is missing or truncated (e.g. the app was
    // killed mid-write on a previous launch).
    if (destination.exists && destination.size === source.size) return;

    source.copySync(destination);
  });

  // `Directory.uri` has no trailing slash, so add exactly one.
  return `${root.uri.replace(/\/+$/, '')}/{fontstack}/{range}.pbf`;
}

export function useGlyphs() {
  const [assets, error] = useAssets(ASSETS);
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    let cancelled = false;

    // Kept async so the state updates land in callbacks rather than during the
    // effect body, which would cause a cascading render.
    const install = async () => {
      if (error) throw error;
      if (!assets) return null;
      return installGlyphs(assets);
    };

    install().then(
      (glyphs) => {
        if (cancelled || !glyphs) return;
        setState({ ready: true, error: null, glyphs });
      },
      (failure) => {
        if (cancelled) return;
        setState({ ready: false, error: failure, glyphs: null });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [assets, error]);

  return state;
}
