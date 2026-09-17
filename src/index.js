import startApp from "./start";

const moveNotice = document.getElementById("orrery-move");
if (moveNotice) {
  if (typeof moveNotice.showModal === "function") moveNotice.showModal();
  else moveNotice.setAttribute("open", "");
  moveNotice.addEventListener("close", () => {
    requestAnimationFrame(() => document.querySelector(".orrery-options-trigger")?.focus());
  });
}

const catalog = __CATALOG_TRIAL__;
export const { orrery, ready } = startApp(async app => {
  if (!catalog) throw new Error("Catalogue configuration is required.");
  const pin = catalog.latest ? null : { ...catalog.pin, url: new URL(catalog.pin.url, document.baseURI).href };
  await app.loadCatalog(pin, { mode: catalog.mode, latest: catalog.latest });
}, { startJed: catalog?.startJed, jedDelta: 0 });
