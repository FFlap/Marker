// Production-only graph optimization lets Metro defer unused startup imports
// without reordering side effects. Set both flags to 0 to compare eager builds.
process.env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH ??= '1';
process.env.EXPO_UNSTABLE_TREE_SHAKING ??= '1';

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../shared')];

// Expo tree shaking preserves side-effect order when deferring module evaluation.
// Keep development imports eager for Fast Refresh and route validation.
if (process.env.EXPO_UNSTABLE_TREE_SHAKING === '1') {
  const getTransformOptions = config.transformer.getTransformOptions;
  config.transformer.getTransformOptions = async (...args) => {
    const options = await getTransformOptions(...args);
    return {
      ...options,
      transform: { ...options.transform, inlineRequires: !args[1].dev },
    };
  };
}

// Linked shared sources must resolve the same Effect instance as the native app.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'effect' || moduleName.startsWith('effect/')) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [__dirname] }),
    };
  }
  return upstreamResolve
    ? upstreamResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css', inlineRem: 16 });
