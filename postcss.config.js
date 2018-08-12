module.exports = {
  ident: "postcss",
  plugins: {
    "postcss-import": {},
    "postcss-preset-env": {
      stage: 0,
      browsers: "last 2 versions"
    },
    cssnano: {}
  }
};
