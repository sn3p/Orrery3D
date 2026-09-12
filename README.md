# Orrery3D

**✨ This is a 3D port of [Orrery](https://github.com/sn3p/Orrery) (2D).**

[Visualization](https://sn3p.github.io/Orrery3D) showing the orbits of [minor planets](https://en.wikipedia.org/wiki/Minor_planet) and their discovery over time.

Two datasets are used to extract the orbital elements and discovery circumstances of minor planets. The data used is maintained by [The Minor Planet Center (MPC)](https://minorplanetcenter.net/):

- [The MPC Orbit (MPCORB) Database](https://minorplanetcenter.net/iau/MPCORB.html) Database containing orbital elements of minor planets.
- [NumberedMPs.txt](https://minorplanetcenter.net/iau/lists/NumberedMPs.txt) Discovery circumstances of numbered minor planets.

## How to use

Use Node.js 24.19.0 (see `.nvmrc`). The build tools require Node.js
`^22.22.3 || ^24.15.0 || >=26.0.0`.

With nvm installed, select the project version first:

```bash
nvm install
nvm use
```

In Conductor, **Setup** runs `npm ci` to install the locked dependencies. The checked-in catalogue is ready to use.

**Run App** starts the default app script. To choose another script, open the **Run** terminal tab and click the small **⌄** beside the Run button in its toolbar. Conductor documents this picker in its [multiple run scripts guide](https://www.conductor.build/changelog/0.70.0-multiple-run-scripts).

The configured scripts are:

| Entry | Starts | Port |
| --- | --- | --- |
| **app** (default) | The 3D app with automatic rebuilds | `CONDUCTOR_PORT` |
| **benchmark** | The production GPU benchmark; select an asteroid count and **Run benchmark** | `CONDUCTOR_PORT + 1` |

Open the localhost URL printed in the run terminal. Each workspace gets its own ports, so both servers can run alongside other workspaces. **The app uses GPU asteroid orbits by default**, with no renderer setting or CPU fallback. Restart the benchmark server after changing benchmark code, and stop other rendering workloads before taking measurements.

If the script picker is unavailable, start the benchmark from a new Conductor terminal in this workspace:

```bash
PORT=$((${CONDUCTOR_PORT:-3000} + 1)) npm run benchmark:serve
```

Open the printed **Benchmark** URL and select **Run benchmark**. This command can run alongside the app.

Shared defaults are in [`.conductor/settings.toml`](.conductor/settings.toml). Conductor's Mac app picks up shared settings after they reach the default branch; a repository-local `.conductor/settings.local.toml` in the main checkout can apply the same commands immediately. Outside Conductor, the commands below start the app on port 3000, and `npm run benchmark:serve` starts the benchmark on port 3001.

Install dependencies:

```bash
npm ci
```

Start server:

```bash
npm run serve
```

Build and bundle:

```bash
npm run build
```

Watch changes and rebuild:

```bash
npm run watch
```

Run the browser regression suite (uses installed Google Chrome):

```bash
npm test
```

To also check Firefox and WebKit:

```bash
npx playwright install firefox webkit
BROWSERS=chromium,firefox,webkit npm test
```

Tests build the real app and exercise loading, playback, discoveries, colours, camera controls, resizing, graphics recovery and errors. They also compare GPU positions against the orbital model across the full catalogue at 12 dates, check extreme elliptical orbits with an independent solver, and compare rendered pixels in overview and close views. Results and screenshots go to `.context/tests/`. WebKit testing is not a substitute for testing Safari and iOS on their actual devices.

## Deployment

[GitHub Pages](https://sn3p.github.io/Orrery3D/) updates automatically after every
push or merged pull request to `master`. The [GitHub Pages workflow](.github/workflows/pages.yml)
installs locked dependencies with the Node.js version in `.nvmrc`, builds a clean
`dist/` from source, and deploys it. Pull requests targeting `master` check the
production build without deploying. A failed build prevents deployment.

Overlapping runs for the same branch retain up to 100 pending runs, processed in
the order they enter GitHub's concurrency queue. New runs beyond that limit are
canceled by GitHub; see the [queue documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-queueing-multiple-pending-runs).

No local build, generated-file commit, or push to `gh-pages` is needed to deploy.
The workflow publishes the checked-in catalogue; it does not download fresh MPC
data.

To deploy `master` again, open **Actions → GitHub Pages → Run workflow**, select
`master`, or use the authenticated [GitHub CLI](https://cli.github.com/):

```bash
npm run deploy
```

This command deploys the remote `master` branch, including when run from a local
feature branch; it does not publish uncommitted local changes. Check progress in
the repository's [Actions tab](https://github.com/sn3p/Orrery3D/actions/workflows/pages.yml).

Repository setup (once, also required for forks): in **Settings → Pages**, set
**Build and deployment → Source** to **GitHub Actions**. In **Settings → Environments
→ github-pages**, allow deployments from the `master` branch. The workflow must be
merged into `master` before automatic or manual deployment is available. It uses
GitHub's built-in token; no personal access token or deploy key is needed.

## Get updated data

The bundled [`data/catalog.json`](data/catalog.json) contains **100,000 objects**. The app uses this checked-in snapshot; it does not fetch fresh MPC data at runtime.

An [import in Orrery](https://github.com/sn3p/Orrery/pull/49) on **12 September 2026** produced **895,910 objects with matching discovery dates** from **1,563,495 orbital records**. The other **667,585** were unnumbered objects without matching discovery records in `NumberedMPs.txt`. These are dated counts that change with MPC updates; see [Orrery issue #47](https://github.com/sn3p/Orrery/issues/47) for the source verification and discovery-date limitation.

Orrery3D currently includes the generated catalogue only; the download/import scripts are not included in this repository. Shared catalogue tooling is being developed in [orrery-data](https://github.com/sn3p/orrery-data), and integration with this app is pending.

Larger catalogues increase download, parsing, preparation and memory costs even with GPU rendering. The benchmark's larger counts repeat the bundled records and positions; the full 895,910-object export has not yet been validated in Orrery3D. The current discovery animation requires a finite discovery date for every object.

## Rendering

Asteroid positions and discovery colours are calculated in a vertex shader within one point batch. Ordinary frames update time uniforms and the discovered draw range; they do not recalculate or upload every position in JavaScript. Planets and orbit lines still use the CPU orbital model.

Playback follows elapsed time: speed `1` means 60 simulated days per second, `0` pauses, and negative speeds reverse. The default `1.5` preserves the old pace at 60 FPS. Hidden tabs and lost graphics contexts pause playback.

At speed `0`, the scene renders only when the camera, date, catalogue or viewport changes, or graphics reconnect. The readout shows `0 FPS` while paused. Resuming playback excludes time spent paused or disconnected.

For maintenance: GPU attributes use Float32, so mean anomalies are refreshed from double-precision phases after a date change beyond 4096 days. This occasional O(N) update limits time-related precision loss. The culling sphere covers the largest full orbit, and the `position` attribute stores an orbital basis, not current coordinates; future picking must account for shader motion. Inputs must describe finite elliptical orbits, with eccentricity still below 1 when stored as Float32. Parsed catalogue objects are released after packing; typed arrays retain the orbital state and discovery dates needed for playback and graphics recovery.

Run `npm run benchmark` to measure the current renderer as asteroid count grows; see the [benchmark instructions](benchmarks/README.md). Timings depend on browser, GPU, display pacing and power settings. Larger benchmark counts repeat bundled records. Tests validate against this project's orbital model, not astronomical accuracy; new catalogue extremes, mobile GPUs and extreme zoom need separate verification.

## Screenshot

![Orrery screenshot](screenshot.png)
