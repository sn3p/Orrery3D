module.exports = ({ mode }) => ({
  ident: "postcss",
  plugins: {
    "postcss-import": {},
    "postcss-preset-env": {
      minimumVendorImplementations: 2
    },
    cssnano: mode === "production" ? {} : false
  }
});
