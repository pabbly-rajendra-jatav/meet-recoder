const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: {
      background: './src/background/background.ts',
      content_script: './src/content/content_script.ts',
      offscreen: './src/offscreen/offscreen.ts',
      recorder: './src/recorder/recorder.ts',
      popup: './src/popup/popup.ts',
      settings: './src/settings/settings.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'src/manifest.json', to: 'manifest.json' },
          { from: 'src/icons', to: 'icons', noErrorOnMissing: true },
        ],
      }),
      new HtmlWebpackPlugin({
        template: './src/popup/popup.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new HtmlWebpackPlugin({
        template: './src/offscreen/offscreen.html',
        filename: 'offscreen.html',
        chunks: ['offscreen'],
      }),
      new HtmlWebpackPlugin({
        template: './src/recorder/recorder.html',
        filename: 'recorder.html',
        chunks: ['recorder'],
      }),
      new HtmlWebpackPlugin({
        template: './src/settings/settings.html',
        filename: 'settings.html',
        chunks: ['settings'],
      }),
    ],
    devtool: isDev ? 'inline-source-map' : false,
    optimization: {
      minimize: !isDev,
    },
  };
};
