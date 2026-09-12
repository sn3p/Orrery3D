# Orrery3D rendering investigation

This compares the production GPU asteroid renderer with a frozen copy of the old JavaScript renderer and an optimized CPU prototype. The app itself has one GPU path; these comparison modes are only available in the benchmark.

Use the project Node.js version (`24.19.0`, pinned in `.nvmrc`) and Google Chrome (or a compatible Chromium executable).

```sh
npm ci
npm run benchmark
```

The automated runner uses an installed Google Chrome, in a separate temporary profile. It disables Chrome Energy Saver **only in that disposable profile**, to prevent a 30 FPS battery-saving cap from contaminating results. It does not change your normal browser or system power settings. It builds into `.context/benchmark/build`, starts a loopback-only server, runs correctness checks and comparisons, saves raw JSON and screenshots to `.context/benchmark/`, and closes its browser/server and removes the profile. It refuses a software GPU unless explicitly overridden. Expect several minutes: the million-object CPU cases are deliberately slow.

For another Chromium executable, set `BROWSER_PATH`. If Chrome is unavailable, install a Playwright Chromium with `npx playwright install chromium`, then point `BROWSER_PATH` at that executable. No browser extensions or existing profile are used.

For an interactive browser run:

```sh
npm run benchmark:serve
```

Open `http://127.0.0.1:3001`, keep it visible, select **Run comparison**, then **Download JSON**. This button runs one repetition at the browser's native device pixel ratio; the automated runner defaults to three repetitions at DPR 1. The speed slider comes from the production GUI; automated comparisons use the fixed `STEP` option, independent of that slider.

The interactive run inherits that browser's power-saving policy. Use the automated runner for a controlled Energy Saver setting, and do not compare its results directly with a throttled interactive run.

Useful automated configurations:

```sh
# Short real-catalogue comparison
COUNTS=100000 MODES=baseline,cpu,gpu REPETITIONS=1 FRAMES=120 npm run benchmark

# Retina rendering and a closer camera
DPR=2 CAMERA=close COUNTS=100000,1000000 REPETITIONS=1 npm run benchmark

# Hardware-backed headless control: measures browser throughput, not a physical display
HEADLESS=1 OUTPUT=.context/benchmark/headless.json npm run benchmark

# Earlier discovery date, backwards playback, narrow viewport
JED=2444270.5 STEP=-1.5 WIDTH=390 HEIGHT=844 DPR=2 COUNTS=100000 REPETITIONS=1 npm run benchmark
```

Options: `COUNTS`, `MODES` (`baseline,cpu,gpu,frozen`), `REPETITIONS`, `FRAMES`, `WARMUP`, `WIDTH`, `HEIGHT`, `DPR`, `CAMERA` (`overview` or `close`), `JED`, `STEP`, `OUTPUT`, `HEADLESS`, `BROWSER_PATH`. Set `ENERGY_SAVER=default` to retain Chrome's default battery-saving policy instead. Default dimensions: 1280 × 800 CSS pixels. Default date: JED 2458600.5; date advances 1.5 days per frame, identical across variants. A paused case uses `STEP=0`. Use a JSON filename for `OUTPUT`; matching PNGs are saved beside it. `PORT` configures the interactive server.

Variants:

| Mode | Work |
| --- | --- |
| `baseline` | Legacy `setupAsteroids()` and `updateAsteroids()` frozen from dependency-update commit `b12721a`, including full position/colour uploads. |
| `cpu` | Precomputed orbital basis; packed doubles; direct eccentric-anomaly coordinates; position upload for discovered objects only; discovery colour calculated by the vertex shader. This measures a bundle of changes, not just one micro-optimization. |
| `gpu` | Actual production `Asteroids`: orbital attributes, 12 Newton iterations (24 for e ≥ 0.99), relative time uniforms, occasional phase refresh, binary-search discovery range and shader colour. |
| `frozen` | Legacy positions calculated once; only scene drawing and planet/GUI updates continue. A lower-work diagnostic control, not a feature-equivalent implementation. |

The fixture imports the real production scene, planet, GUI and GPU asteroid code, replacing the scheduler and the selected asteroid implementation. It omits the production stats begin/end calls. All variants use the same `PointsMaterial` shader pipeline, size attenuation, depth settings, antialiasing, scene and camera. The variants are rebuilt between cases; buffers and shaders are warmed before measurement. The CPU prototype disables frustum culling to avoid stale position bounds. Production GPU rendering uses a conservative sphere containing every orbit.

The catalogue contains 100,000 records. Lower counts use the discovery-sorted prefix; larger counts **repeat the exact records and positions**. They exercise more vertices and CPU iterations but do not represent a million unique MPC objects or realistic million-record loading/memory costs. Discovery counts refer to submitted points; offscreen and overlapping points are still counted. Do not equate this with individually distinguishable pixels.

Metrics:

- `fps` and `frameMs`: actual `requestAnimationFrame` intervals, including waits, presentation pacing and scheduling. FPS is total frames / total interval time. It is not calculated as 1 / median CPU time. Browser/OS/display pacing can cap or change this independently of GPU cost.
- `asteroidUpdateMs`: JavaScript orbit/update cost; `mainThreadMs`: update + planet update + renderer submission + GUI. These are not GPU-completion times; timer resolution can round tiny values to zero.
- `gpuMs`: asynchronous `EXT_disjoint_timer_query_webgl2` around renderer submission, including upload/draw commands. No `gl.finish` or readback in timed frames. Disjoint samples are discarded. This is a diagnostic GPU elapsed interval, not isolated vertex-shader time or an FPS prediction.
- `setupMs`: variant setup after data selection, with CPU preparation/sorting; excludes JSON fetch/parse and asynchronous shader compilation. It is not a startup benchmark.
- `phaseRefresh`: a separately forced GPU-mode date jump just beyond the 4096-day rebase threshold, after ordinary samples finish. Reports CPU update/submission, the following frame interval and uploaded bytes. This occasional O(N) refresh must not be hidden behind steady-state FPS; one sample per run is a diagnostic, not a latency distribution.
- `longTasks`: browser tasks of at least 50 ms observed during sampling. Observer delivery may straddle the measurement boundary.

The runner records browser/GPU identity, viewport, dates, counts, source commit, catalogue hash, individual samples and browser errors. It rotates mode order and reverses count order between repetitions. It runs one workload at a time. Headless and headed results must be reported separately.

Preview PNGs capture the canvas synchronously with rendering, outside the timed frames. This avoids relying on a later screenshot of WebGL's non-preserved drawing buffer. The PNGs contain the scene, without the surrounding HTML controls. Correctness checks also compare the actual canvas across baseline/CPU/GPU/CPU transitions.

Correctness checks execute the actual GLSL and production-packed attributes via WebGL2 transform feedback. They compare the whole catalogue at 12 dates (1801–2100), including just before/at/after positive and negative phase-refresh boundaries, against `Orbit.getPosAtTime`. They also check CPU equivalence, finite values, projected overview error, discovery/rewind/pause boundaries, fade endpoints and rendered pixels in overview/close scenes. Another 54 synthetic eccentric-orbit cases use an independent bisection solver. Pixel comparisons use a 640 × 400 multisampled target and linear output. These are checks against the project's orbital model, not validation of astronomical accuracy. The supplied catalogue's maximum eccentricity is about 0.961; arbitrary future data, hyperbolic orbits, extreme zoom and other GPUs still require validation.

A legacy fade bug is retained in validation results as `existingFadeBug`: crossing the cutoff could leave slightly green colour in the old CPU buffer. The production GPU path calculates clamped colour from absolute date and fixes that behaviour. `npm test` separately exercises the real app, including rendered fade completion/rewind, equal playback at 30/60/120 Hz and graphics-context recovery.

Read the [investigation report](../docs/performance/investigation.md) for results, recommendations and limitations.
