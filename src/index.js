import startApp from "./start";

const catalog = __CATALOG_TRIAL__;
const resumeSpeed = catalog?.speed ?? 1.5;
const moveNotice = document.getElementById("orrery-move");
if (moveNotice) {
  if (typeof moveNotice.showModal === "function") moveNotice.showModal();
  else moveNotice.setAttribute("open", "");
}

export const { orrery, ready } = startApp(async app => {
  if (!catalog) throw new Error("Catalogue configuration is required.");
  const pin = catalog.latest ? null : { ...catalog.pin, url: new URL(catalog.pin.url, document.baseURI).href };
  await app.loadCatalog(pin, { mode: catalog.mode, latest: catalog.latest });
}, { startJed: catalog?.startJed, jedDelta: 0 });

if (moveNotice) {
  moveNotice.addEventListener("close", () => {
    orrery?.gui.setPlaybackSpeed(resumeSpeed);
    requestAnimationFrame(() => document.querySelector(".orrery-options-trigger")?.focus());
  }, { once: true });
}
