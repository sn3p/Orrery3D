// Large numerical/rendering control only. The configured production entry is
// independently exercised by the indexed, whole and shared-source workflows.
import startApp from "../src/start";
import catalogUrl from "../data/catalog.json";

export const { orrery, ready } = startApp(async app => {
  const response = await fetch(catalogUrl);
  if (!response.ok) throw new Error(`Renderer fixture request failed: ${response.status}`);
  app.setupAsteroids(await response.json());
});
