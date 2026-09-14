// The actual configured boot; this wrapper adds inspection only, no test data.
import { orrery, ready } from "../src";
import CatalogSource from "../src/js/catalog/CatalogSource";
import { prepareCatalogue } from "../src/js/prepareCatalogue";
import { REFERENCE_JED, REBASE_DAYS } from "../src/js/Asteroids";
window.catalogTest = { get app() { return orrery; }, CatalogSource, prepareCatalogue, REFERENCE_JED, REBASE_DAYS };
window.catalogReady = ready;
