const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: {
    main: "./src/index.js"
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js"
  },
  externals: {
    three: "THREE"
    // "ar.js": "THREEx"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader"
        }
      },
      {
        test: /\.css$/,
        use: [
          "style-loader",
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { importLoaders: 1 } },
          "postcss-loader"
        ]
      },
      {
        test: /\.json$/,
        type: "javascript/auto",
        use: [
          {
            loader: "file-loader",
            options: {
              name: "data/[name].[ext]"
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new HtmlWebpackPlugin({
      inject: false,
      hash: true,
      template: "./src/index.html",
      filename: "index.html"
    })
  ],
  devServer: {
    port: 8080,
    watchContentBase: true,
    watchOptions: {
      ignored: /node_modules/
    }
  }
};
