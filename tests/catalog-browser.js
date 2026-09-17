// The actual configured boot; this wrapper adds inspection only, no test data.
import { orrery, ready } from "../src";
import CatalogSource from "../src/js/catalog/CatalogSource";
import { prepareCatalogue } from "../src/js/prepareCatalogue";
import { REFERENCE_JED, REBASE_DAYS } from "../src/js/Asteroids";

// Historical browser scenarios exercise the application behind the retirement
// notice. Import the real production entry, then dismiss its modal once for all
// consumers of this inspection wrapper.
document.getElementById("orrery-move")?.close();

window.catalogTest = { get app() { return orrery; }, CatalogSource, prepareCatalogue, REFERENCE_JED, REBASE_DAYS };
window.catalogReady = ready;
