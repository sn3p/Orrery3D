const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const index = fs.readFileSync(path.join(output, "index.html"), "utf8");
const fallback = fs.readFileSync(path.join(output, "404.html"), "utf8");

function links(document) {
  return [...document.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
}

test("the production artifact contains the paused application and static fallback", () => {
  const files = fs.readdirSync(output, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(output, path.join(entry.parentPath, entry.name)))
    .sort();
  assert.deepEqual(files, [
    "404.html",
    "bundle.js",
    "fonts/JetBrainsMono-Variable.woff2",
    "fonts/OFL.txt",
    "index.html",
    "main.css",
  ]);
});

test("the application entry has a closable move dialog with only the two Orrery destinations", () => {
  assert.match(index, /<dialog\b[^>]*id="orrery-move"/);
  assert.match(index, /aria-label="Close move notice"/);
  assert.match(index, /<h1[^>]*>Orrery3D has moved<\/h1>/);
  assert.match(index, /close this dialog to explore the original Orrery3D/);
  assert.doesNotMatch(index, /orrery-move-mode|>2D view<|>3D view</i);
  assert.doesNotMatch(index, /orrery-move-destination-primary/);
  assert.deepEqual(links(index), [
    "https://sn3p.github.io/Orrery/?renderer=three",
    "https://sn3p.github.io/Orrery/",
  ]);
  assert.doesNotMatch(index, /Historical site|View the historical source/i);
  assert.match(index, /<script\b[^>]*bundle\.js/);
});

test("the fallback keeps the two destinations without loading the renderer", () => {
  assert.match(fallback, /<h1>Orrery3D has moved<\/h1>/);
  assert.deepEqual(links(fallback), [
    "https://sn3p.github.io/Orrery/?renderer=three",
    "https://sn3p.github.io/Orrery/",
  ]);
  assert.doesNotMatch(fallback, /Historical site|View the historical source/i);
  assert.doesNotMatch(fallback, /class="mode"|>2D view<|>3D view</i);
  assert.doesNotMatch(fallback, /<script\b|<canvas\b/i);
  assert.doesNotMatch(fallback, /http-equiv=["']refresh/i);
});
