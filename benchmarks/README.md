# GPU rendering benchmark

Measures the production renderer as asteroid count grows. Shader correctness is checked separately by `npm test`; there are no alternative CPU renderers in this harness.

```sh
# Automated run: installed Google Chrome, three repetitions, 10k–1m points
npm run benchmark

# Quick check at two counts
COUNTS=100000,1000000 REPETITIONS=1 FRAMES=90 npm run benchmark

# Closer camera, Retina resolution, reverse playback
CAMERA=close DPR=2 STEP=-1.5 COUNTS=100000 REPETITIONS=1 npm run benchmark

# Interactive count selector and JSON download
npm run benchmark:serve
```

Open the printed URL and select **Run benchmark**. Keep the tab visible and stop other rendering workloads. Restart the server after code changes. Interactive runs use the browser's native DPR and power policy; automated runs default to DPR 1 and disable Chrome Energy Saver in a disposable profile only. Your normal browser settings are unchanged.

The automated runner saves JSON and a preview PNG to `.context/benchmark/`, then closes its browser/server. Results include source fingerprints, browser/GPU identity, power state, viewport, dates and individual samples. It refuses software rendering unless `ALLOW_SOFTWARE=1`. A headless run (`HEADLESS=1`) measures browser throughput; report it separately from headed results.

| Metric | Meaning |
| --- | --- |
| `fps`, `frameMs` | Actual animation-frame intervals, including browser/OS/display pacing. These do not establish the GPU's maximum frame rate. |
| `asteroidUpdateMs`, `mainThreadMs` | CPU time for asteroid updates, and for updates plus planet/GUI work and draw submission. Neither waits for GPU completion. |
| `gpuMs` | Asynchronous WebGL timer query around drawing, when available. Disjoint samples are discarded; no synchronous GPU wait/readback occurs in timed frames. |
| `setupMs` | Catalogue preparation/replacement; excludes fetch, JSON parsing, repeated-record selection and shader compilation. |
| `phaseRefresh` | One separately forced date jump beyond 4096 days: CPU update/submission cost, following frame interval and uploaded bytes. This occasional O(N) work is separate from ordinary frames. |
| `longTasks` | Tasks of at least 50 ms observed during sampling; callback delivery may straddle its boundaries. |

Counts above the bundled catalogue size **repeat the exact records and positions**. They test vertex/overlap load, not unique orbits or realistic larger-catalogue download, preparation and memory costs. `discovered`/`points` count submitted points, including overlapping and offscreen ones. The harness uses the real scene, materials and GUI updates with its own finite scheduler; the fixed date step makes runs repeatable.

Options: `COUNTS`, `REPETITIONS`, `FRAMES`, `WARMUP`, `WIDTH`, `HEIGHT`, `DPR`, `CAMERA` (`overview`/`close`), `JED`, `STEP`, `OUTPUT`, `HEADLESS`, `BROWSER_PATH`, `ENERGY_SAVER` (`default` retains browser policy). Defaults: 1280 × 800 CSS pixels, JED 2458600.5, step 1.5 days/frame, 120 measured frames and 30 warmup frames. `STEP=0` pauses; negative values reverse. Count order reverses between repetitions. `PORT` configures the interactive server (default 3001).
