const path = require('path');

module.exports = {
  entry: {
    index: [
      './src/skill-build-automatic-entry.ts',
      './src/desktop-version.ts',
      './src/live-build-hud-entry.ts',
      './src/live-build-exposure-entry.ts',
      './src/live-build-overlay-recovery.ts',
      './src/index.ts',
    ],
    dynamo_warning: './src/dynamo_warning.ts',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'public/dist'),
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
};
