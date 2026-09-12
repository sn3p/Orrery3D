# Production GPU asteroid renderer

The 3D app now calculates asteroid positions and discovery colours in a vertex shader, keeping its existing single `THREE.Points` batch. There is no renderer selector or CPU fallback. The old JavaScript asteroid implementation lives only in `benchmarks/legacy-asteroids.js` as an independent performance reference. Planet positions and orbit lines still use the existing CPU orbit model.

In Conductor, use **Run App** as before. Outside Conductor, run `npm ci` and `npm run serve`. The separate benchmark compares the legacy CPU renderer, an optimized CPU prototype and this actual production GPU implementation. See [benchmark instructions](../../benchmarks/README.md) and the [original investigation](investigation.md).

## What changed

`src/js/Asteroids.js` prepares two orbital basis vectors, eccentricity, mean anomaly, mean motion and discovery date once. The vertex shader solves Kepler's equation and calculates each submitted point. Ordinary frames update two relative-date uniforms and binary-search the discovery-sorted dates to set the draw range. They do not call the JavaScript asteroid orbit solver or upload position/colour buffers.

The GPU attributes occupy 40 bytes per asteroid. CPU copies of those attributes plus double-precision phase/discovery arrays occupy another 64 bytes per asteroid, excluding the retained catalogue objects, sorted reference array and transient preparation allocations. These are buffer-size calculations, not measured total application memory. A conservative sphere based on the largest aphelion contains all moving points and allows normal object-level frustum culling without recomputing positions on the CPU.

The shader uses relative time to limit Float32 error. If playback or a date jump moves more than 4096 simulated days from the local epoch, JavaScript refreshes the mean anomalies and uploads the 12-byte-per-object orbital-elements attribute. This occasional O(N) pass is measured separately from ordinary frames. At default speed it occurs roughly every 45.5 seconds of uninterrupted playback. It does not solve each orbit or calculate each position on the CPU.

Playback now follows elapsed time. The existing slider scale is preserved at a reference 60 FPS: `1` means 60 days/second, the default `1.5` means 90 days/second, `0` pauses, and negative values reverse. Higher rendering FPS no longer accelerates history. Hidden documents and lost graphics contexts pause the clock. Individual elapsed intervals are capped at 250 ms to avoid a large jump after an OS sleep or long stall.

Discovery colour comes directly from the current date. It reaches the final grey even when a frame crosses the fade cutoff, and restores green correctly when rewinding or rediscovering an asteroid. Zero fade duration and zero-valued constructor options work. Invalid or unsupported orbital data fails before replacing a working cloud; load failures and graphics errors are visible. Hyperbolic orbits and eccentricities that round to 1 in Float32 are rejected.

Graphics-context loss clears old Three.js GPU resources while retaining CPU attributes and materials. Restoration recreates the buffers and shaders automatically. Clearing resources on loss also prevents stale Three r186 geometry-disposal listeners from deleting pre-loss handles later in WebKit. Full app disposal removes the animation loop, controls, listeners, canvas and GPU resources.

## Measured performance

The integrated renderer was measured on an Apple M3 Max, plugged in, using Chrome 151 / Three r186 / WebGL2 at 1280 × 800, DPR 1 and the overview camera. Three repetitions per mode/count, with 20 warm-up and 90 measured frames, produced the following median per-run values. Energy Saver was disabled only in the disposable benchmark profile. [Raw results](results/gpu-integration.json).

| Submitted asteroids | Legacy CPU FPS | Optimized CPU FPS | Production GPU FPS | Legacy asteroid CPU update | Production main-thread work | Production GPU elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 real records | 50.2 | 90.8 | 120.0 | 19.6 ms | 0.2 ms | 0.65 ms |
| 1,000,000 repeated records | 5.1 | 9.4 | 135.9 | 192.5 ms | 0.2 ms | 3.22 ms |

GPU-mode p95 frame intervals were 9.2 ms at 100k and 8.6 ms at 1m. Ordinary asteroid updates usually rounded to zero at the browser's timer resolution; this does not mean they have zero cost. All 18 cases completed without browser errors. These are measured animation-frame rates, not a guarantee of distinct physically presented frames. GPU repetitions varied from roughly 120–137 FPS because browser/display pacing varied; the larger population's higher median does not mean more asteroids render faster.

Forced phase refreshes took 0.3–0.7 ms of CPU update at 100k and 4.2–7.5 ms at 1m, plus submission/upload work. The million-point refresh uploads 12 MB; its total measured main-thread work was 5.5–8.1 ms. These are three isolated diagnostic samples, not a sustained latency distribution. The calculation uses floor-based angle wrapping after an earlier check found triple remainder operations caused a roughly 30 ms million-record refresh.

GPU setup after catalogue selection took a median 23.4 ms at 100k and 235.7 ms at 1m. That excludes JSON fetch/parse and asynchronous shader compilation. The gain addresses per-frame rendering; it does not remove loading or memory costs.

A focused 1m-point, DPR 2 closer-camera run also passed, measuring 133.7 FPS and 2.22 ms median GPU elapsed. It is one different clipping/pixel workload, not evidence that zooming universally improves speed. [Retina/close result](results/gpu-integration-retina-close.json).

## Verification

Run `npm test` for Chrome, or install Playwright's Firefox/WebKit and run `BROWSERS=chromium,firefox,webkit npm test`. The suite builds the real production entry point and a fixture importing that entry point; the production bundle exposes no test global.

Coverage includes the real catalogue fetch and reload, loading/network/invalid-data errors, keyboard speed changes, camera drag/zoom, desktop/narrow layouts, discovery inclusion boundaries, empty/replaced catalogues, unchanged attribute versions on ordinary frames, phase refresh, conservative bounds, and rendered discovery colours across forward/reverse jumps. Controlled calls to the real render loop verify equal elapsed dates at 30/60/120 Hz, pause/reverse and visibility/context suspension. Visibility state is emulated in this automated clock check; it is not a claim about every OS's background-tab policy.

Chrome 151.0.7922.170, Firefox 155 and Playwright WebKit 26.6 passed the suite. The graphics test performs two actual WebGL loss/restoration cycles, checks pixel-identical recovered scenes while paused, then disposes and recreates the app. This regression caught the WebKit stale-buffer disposal problem. [Retained browser results](results/gpu-integration-browser-tests.json); inspected screenshots are written to `.context/tests/`.

The benchmark executes production-packed attributes and the actual GLSL for 1,200,000 catalogue/date pairs across 1801–2100, including both sides of positive and negative phase-refresh boundaries. It also checks 54 synthetic eccentric-orbit cases against an independent bisection solver, 30 discovery transitions, 10 colour boundaries and 13 rendered comparisons against the legacy implementation. These verify the project's orbital model, not astronomical accuracy.

No non-finite results occurred. Maximum projected overview error was 0.00124 CSS pixels; maximum world-space error across all catalogue samples was 0.0641 units (100 units = 1 AU). The synthetic eccentric cases had maximum world error 0.00112 units. Rendered mean channel differences were below 0.0014 on a 0–255 scale in the checked overview/close/early-discovery scenes.

The normal development server and production build passed animation, real speed-input pause/forward/reverse, camera drag/zoom, resize and reload checks. `npm run build` regenerated tracked `dist/`; its JavaScript exactly matches the production bundle exercised by the browser suite. The build retains the existing bundle/catalogue size recommendations. An independent source review found no remaining correctness issues after the rebase-cost and recovery fixes.

## Remaining scope

The bundled catalogue still contains 100,000 real records. Million-point comparisons repeat those records and exact positions; they do not establish startup time, memory use or rendering behaviour for a million unique current MPC objects. Larger real catalogues, integrated/mobile GPUs, actual Safari/iOS devices and extreme zoom remain separate validation work. WebKit and Firefox tests on this Mac expand engine coverage but do not establish a universal performance floor.

A supplementary attempt to trigger native hidden-document state in the automated headed Chrome session remained unverified: the document reported visible even after the window reported minimized or another page was activated. The deterministic visibility-event/render-loop regression passed; native OS background policy is not claimed as tested.

Quadtrees/octrees, adaptive resolution, aggregation, binary catalogue loading and workers remain candidates only if a measured workload needs them. No 2D Orrery code was changed.
