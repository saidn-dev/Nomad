const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('mbtiles');
// Offline MapLibre glyph PBFs, bundled as assets and copied onto the device
// filesystem at startup (see src/glyphs.js).
config.resolver.assetExts.push('pbf');

module.exports = config;
