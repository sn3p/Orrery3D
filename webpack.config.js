const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: {
    main: "./src/index.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
    chunkFormat: false,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { importLoaders: 1 } },
          "postcss-loader",
        ],
      },
      {
        test: /\.(woff2|txt)$/,
        include: path.resolve(__dirname, "src/fonts"),
        type: "asset/resource",
        generator: {
          filename: "fonts/[name][ext]",
        },
      },
      {
        test: /\.json$/,
        type: "asset/resource",
        generator: {
          filename: "data/[name][ext]",
        },
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new HtmlWebpackPlugin({
      inject: false,
      hash: true,
      template: "./src/index.html",
    }),
  ],
  optimization: {
    splitChunks: false,
    minimizer: [
      new TerserPlugin({
        exclude: /hot-update\.js$/,
        extractComments: false,
      }),
    ],
  },
  devServer: {
    port: 3000,
    open: true,
    static: {
      directory: path.join(__dirname, "dist"),
    },
    watchFiles: {
      paths: ["src/**/*"],
      options: {
        ignored: /node_modules/,
      },
    },
  },
};
