import startApp from "./start";

const catalog = __CATALOG_TRIAL__;
export const { orrery, ready } = startApp(async app => {
  if (!catalog) throw new Error("Catalogue configuration is required.");
  const pin = catalog.latest ? null : { ...catalog.pin, url: new URL(catalog.pin.url, document.baseURI).href };
  await app.loadCatalog(pin, { mode: catalog.mode, latest: catalog.latest });
}, { startJed: catalog?.startJed, jedDelta: catalog?.speed });
