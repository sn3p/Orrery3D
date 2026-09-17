const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "retirement", "index.html"), "utf8");
const output = path.join(root, "dist");

test("the production artifact contains only the retirement documents", () => {
  assert.deepEqual(fs.readdirSync(output).sort(), ["404.html", "index.html"]);
  assert.equal(fs.readFileSync(path.join(output, "index.html"), "utf8"), source);
  assert.equal(fs.readFileSync(path.join(output, "404.html"), "utf8"), source);
});

test("the notice provides the maintained destinations without an automatic redirect", () => {
  assert.match(source, /<html lang="en">/);
  assert.match(source, /<main>/);
  assert.match(source, /<h1>Orrery3D has moved<\/h1>/);
  assert.match(source, /This standalone site is no longer maintained\./);
  assert.match(source, /aria-label="Orrery destinations"/);
  assert.match(source, /rel="canonical" href="https:\/\/sn3p\.github\.io\/Orrery\/\?renderer=three"/);

  const links = [...source.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, [
    "https://sn3p.github.io/Orrery/?renderer=three",
    "https://sn3p.github.io/Orrery/",
    "https://github.com/sn3p/Orrery3D",
  ]);

  assert.doesNotMatch(source, /<script\b/i);
  assert.doesNotMatch(source, /<canvas\b/i);
  assert.doesNotMatch(source, /http-equiv=["']refresh/i);
  assert.doesNotMatch(source, /@keyframes|animation\s*:/i);
});
