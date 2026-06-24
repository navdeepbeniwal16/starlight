module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        // Required by react-native-reanimated v4 (worklets). Must be listed last.
        plugins: ['react-native-worklets/plugin'],
    };
};
