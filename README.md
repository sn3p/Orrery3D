# Orrery3D

## Orrery3D has moved

The 3D view is now part of [Orrery](https://github.com/sn3p/Orrery), alongside
the original 2D view. This standalone site and application are no longer
maintained.

- **[Open Orrery in 3D](https://sn3p.github.io/Orrery/?renderer=three)**
- [Open Orrery in 2D](https://sn3p.github.io/Orrery/)
- [Open the historical Orrery3D site](https://sn3p.github.io/Orrery3D/)

This repository remains available as a historical record. Its source, tests,
fixtures, documentation, licenses, and Git history are intentionally retained.
The production entry opens the final Three.js scene paused behind a move dialog.
Visitors can continue to either Orrery view or close the dialog to inspect the
original Orrery3D. Obsolete paths use a lightweight `404.html` with the same two
destinations.

## Retirement site maintenance

Use Node.js 24.19.0 (see `.nvmrc`). The build tools require Node.js
`^22.22.3 || ^24.15.0 || >=26.0.0`.

```bash
npm ci
npm run build -- --output-clean
npm test
```

The build emits the retained application bundle, styling and font assets plus a
static `404.html`. The browser check loads the actual production bundle with a
fixture catalogue, verifies paused playback, dialog focus/dismissal, both
destinations, narrow and desktop layout, and a JavaScript-free fallback.

For local inspection, including Conductor's **Run App** action:

```bash
npm run serve -- --host 127.0.0.1 --port 3000 --no-open
```

The local server shows the same move dialog over the original Orrery3D as the
production entry. Closing the dialog leaves playback at speed `0`; the existing
options panel can resume it for inspection.

## Deployment

[GitHub Pages](https://sn3p.github.io/Orrery3D/) updates automatically after a
push or merged pull request to `master`. The
[GitHub Pages workflow](.github/workflows/pages.yml) installs locked
dependencies, builds the retirement artifact, and runs its structural and
headless rendered checks before deployment. Pull requests targeting `master`
run the same checks without deploying.

`dist/` is generated and ignored. No generated files or `gh-pages` commit are
needed. To rerun deployment for the remote `master` branch, use **Actions →
GitHub Pages → Run workflow**, or:

```bash
npm run deploy
```

Repository setup for forks remains **Settings → Pages → Build and deployment →
GitHub Actions**, with the `master` branch allowed in the `github-pages`
environment.

## Historical standalone application documentation

The sections below describe the final standalone Three.js application preserved
beneath the current move dialog. The complete pre-retirement README is preserved in
[the historical standalone documentation](docs/historical-standalone-readme.md).

The application was a 3D port of [Orrery](https://github.com/sn3p/Orrery),
visualizing the orbits of [minor planets](https://en.wikipedia.org/wiki/Minor_planet)
and their discovery over time.

Two datasets were used to extract orbital elements and discovery circumstances.
The data is maintained by [The Minor Planet Center (MPC)](https://minorplanetcenter.net/):

- [The MPC Orbit (MPCORB) Database](https://minorplanetcenter.net/iau/MPCORB.html), containing orbital elements of minor planets.
- [NumberedMPs.txt](https://minorplanetcenter.net/iau/lists/NumberedMPs.txt), containing discovery circumstances of numbered minor planets.

The final standalone release loaded the current indexed catalogue directly from
[orrery-data Pages](https://sn3p.github.io/orrery-data/). Its loader, renderer,
benchmark, build configuration, and regression suites remain in the tree for
provenance. See [catalogue delivery](docs/catalog-delivery.md), the
[benchmark instructions](benchmarks/README.md), and the retained tests for the
complete implementation record.

### Catalogue at retirement

The final application selected the **895,910-object indexed catalogue** in
`catalog.config.json`; it had no 100,000-object cap. The displayed count followed
the simulation date and reached the complete discovery-dated population as time
advanced. The former catalogue is retained under
[`tests/fixtures/renderer/`](tests/fixtures/renderer/README.md) for numerical and
renderer regression provenance.

An [import in Orrery](https://github.com/sn3p/Orrery/pull/49) on **12 September
2026** produced **895,910 objects with matching discovery dates** from
**1,563,495 orbital records**. The other **667,585** were unnumbered objects
without matching discovery records in `NumberedMPs.txt`. These are dated counts
that change with MPC updates; see [Orrery issue #47](https://github.com/sn3p/Orrery/issues/47)
for the source verification and discovery-date limitation.

Shared catalogue processing and hosting belong to
[orrery-data](https://github.com/sn3p/orrery-data). The retained delivery
documentation describes the final indexed, whole-bundle, cache, verification,
and rollback contracts.

### Rendering at retirement

Asteroid positions and discovery colours were calculated in a vertex shader
within one point batch. Ordinary frames updated time uniforms and the discovered
draw range; they did not recalculate or upload every position in JavaScript.
Planets and orbit lines used the CPU orbital model.

Each planet cached its fixed orbital basis and ellipse scale, updating its
existing position vector each frame. Orbit tracks reused the same prepared
calculations across their samples. The Sun and planets shared sphere construction
while keeping separate geometry and material ownership.

Playback followed elapsed time: speed `1` meant 60 simulated days per second,
`0` paused, and negative speeds reversed. Hidden tabs and lost graphics contexts
paused playback. At speed `0`, the scene rendered only when the camera, date,
catalogue, viewport, or graphics connection changed.

Rendering started at **1×** on every load. Displays with a pixel ratio of at
least 2× offered a **DPR** option for 1× or 2× rendering during the current page
session. Benchmarks used an independent requested DPR.

GPU attributes used Float32, so mean anomalies were refreshed from
double-precision phases after a date change beyond 4096 days. Only the scalar
`meanAnomaly` buffer was uploaded during a refresh. Catalogue validation, stable
discovery sorting, and typed-array packing lived in
`src/js/prepareCatalogue.js`, independently of Three.js.

The preserved tests validate the project orbital model rather than establishing
astronomical accuracy. Their historical browser diagnostics and screenshots do
not certify every physical device, graphics driver, Safari/iOS release, or
extreme catalogue input.

### Historical screenshot

![Orrery3D screenshot](screenshot.png)
