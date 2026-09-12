# Orrery3D rendering performance investigation

Originally investigated 12 September 2026 against commit `283ec41847837bfaa3bea171ad0dbefcd3c75ad4` (Three.js r179). The workspace is now rebased onto merged dependency PR [#8](https://github.com/sn3p/Orrery3D/pull/8), commit `b12721a941c2134809dd50d02d908efe57487dba` (Three.js r186). Original measurements below remain labelled separately from the follow-up verification. The investigation led to the [production GPU integration](gpu-renderer.md). The historical prototype results below are retained separately; PR #2 itself was not modified.

**Recommendation: move asteroid orbit calculation and discovery colour to the vertex shader, keeping the existing single `THREE.Points` batch.** This directly attacks the measured bottleneck. Improving the CPU implementation helps, but still scales poorly at several hundred thousand asteroids. A quadtree is not the first optimization for this workload.

**Historical verification after the dependency update, before GPU integration (Three.js r186)**

The rebased app passes a clean `npm ci` (zero audit vulnerabilities), production build, and production/development browser checks for animation, pause/forward/reverse speed input, camera drag/zoom, resizing from 1280 × 800 to 390 × 844, and fresh reloads. The build retains bundle/catalogue size recommendations. No application runtime errors occurred; the development server still returns 404 for its absent favicon. At that checkpoint, production source and tracked `dist/` matched merged master.

The prototype needed one compatibility correction: its discovery-colour hook assigned a `vec3`, while r186's `vColor` varying is a `vec4`. This prevented both optimized materials from compiling. The existing rendered-pixel coverage assertion caught the missing asteroids before timing began. The hook now supplies alpha 1, and the assertion reports pixel counts and scene details on failure. The numerical solver and production app were unaffected. [Three.js r186 colour varying](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/color_pars_vertex.glsl.js).

Reviewing the static previews also found an unreliable delayed screenshot after a GPU-to-CPU transition. Synchronous canvas readback matched the baseline, while a later page screenshot could omit the asteroid cloud. Preview PNGs now capture the canvas within the rendering call, outside timed frames. Four additional actual-canvas comparisons cover baseline/CPU/GPU/CPU transitions alongside the nine render-target comparisons.

The repeat comparison used the same M3 Max, Chrome 151, WebGL2, 1280 × 800 overview, DPR 1, dates, 20 warm-up frames and 90 measured frames. Three repetitions per mode/count, rotating mode order and reversing count order, produced these median per-run values:

| Submitted asteroids | Legacy CPU FPS | Optimized CPU FPS | GPU-orbit FPS | Legacy CPU orbit/update | Optimized CPU orbit/update | GPU-orbit GPU elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 real records | 50.8 | 91.9 | 132.8 | 19.4 ms | 10.7 ms | 0.61 ms |
| 1,000,000 (repeated records) | 5.2 | 9.1 | 120.1 | 192.7 ms | 108.7 ms | 2.91 ms |

At one million points the GPU variant's measured main-thread work was 0.3 ms, with a p95 frame interval of 9.2 ms. All 500,000 orbit/date comparisons, 30 discovery checks, 10 colour boundary checks and 13 rendered comparisons passed, with zero browser errors. Maximum overview position error remained about 0.0153 CSS pixels; CPU rendered output matched the baseline exactly in the tested scenes. [Raw r186 results](./results/after-dependency-update.json).

These results confirm the recommendation on the updated dependencies; they do not isolate a performance change caused by upgrading Three.js. This run was plugged in at 78% battery, unlike the earlier battery-powered run. Browser pacing also varied: GPU repetitions reported approximately 120–137 FPS. The table uses the median rather than treating any individual FPS as a hardware ceiling. Energy Saver was disabled only in the disposable benchmark profile. The million-point case still repeats the real 100k catalogue, and the earlier Retina/frozen controls were not repeated in this follow-up.

Subsequent status: GPU orbits are now integrated as the sole production asteroid path. Elapsed-time playback, discovery/fade behaviour, moving-object bounds and context recovery are implemented. See [implementation, current measurements and remaining limits](gpu-renderer.md); the tables in this investigation describe the earlier checkpoints.

**How the recommendation addresses the JavaScript bottleneck**

The primary recommendation replaces the per-frame JavaScript calls to `Orbit.getPosAtTime()` for asteroids with orbit calculation in the GPU vertex shader. This is the `gpu` variant already implemented and measured in the benchmark. It is now integrated in the production app, with no CPU fallback or user-facing backend setting.

| Work | Original CPU implementation | Implemented GPU approach |
| --- | --- | --- |
| Prepare fixed orbital orientation and ellipse geometry | Recalculate inside each asteroid's position calculation every frame. | Precompute once when loading the catalogue and upload static orbital attributes. |
| Solve Kepler's equation and calculate the current asteroid position | JavaScript loops over all discovered asteroids. | The vertex shader calculates each submitted asteroid's position from its orbital attributes and the current date. |
| Calculate discovery colour | JavaScript changes a colour buffer. | The vertex shader derives colour from discovery date and current date. |
| Send asteroid updates to the GPU | Upload the full position and colour buffers each frame. | Update relative-date uniforms and discovery draw range. Refresh orbital phases only when the date moves over 4096 days from the local epoch. |
| Determine which asteroids have been discovered | Scan the discovery-sorted data during the position loop. | Binary-search the sorted discovery dates and submit the discovered prefix. |

Asteroids still move every frame. The total orbit calculation remains proportional to the number of submitted asteroids, but that calculation runs in parallel on the GPU. JavaScript's asteroid work becomes the small date/discovery update; planet updates, camera controls, scene submission and GUI work still remain on the CPU. The relevant shader work is **solving the orbit itself**. A shader that only changes point appearance would leave the costly JavaScript orbit loop in place.

The measured million-object stress test demonstrates this change: the current JavaScript asteroid update took about **179.5 ms per frame**. With GPU orbits, the **whole measured main-thread workload** was about **0.3 ms**, while GPU rendering took about **3.67 ms** and delivered roughly **120 FPS**. These are separate CPU/GPU measurements, not a claim that an entire frame finishes in 0.3 ms. The million-object case repeats the real 100,000-record catalogue; its full methodology and limits are below.

The recommendations have different purposes:

- **GPU orbit calculation directly removes the measured bottleneck from JavaScript.** This is the implemented production approach.
- **CPU precomputation and packed arrays reduce the cost of that same loop.** The benchmark still needed about 99.4 ms per frame at one million repeated objects, so this is useful as a benchmark reference, not sufficient for the large-count goal by itself. No production CPU fallback is retained.
- **Culling, resolution controls, loading improvements and other later options address different or conditional costs.** They are not prerequisites for the measured GPU improvement. Profile them after integration if a new bottleneck appears.

**What the original CPU app spent time doing**

The [frozen legacy `setupAsteroids()`](../../benchmarks/legacy-asteroids.js) already creates one `BufferGeometry` and one `THREE.Points` object for the whole asteroid catalogue. The app does not create thousands of individual asteroid meshes or draw calls. `PointsMaterial` already uses GPU shaders to draw points. Changing the material to a custom shader is useful only if it moves meaningful work out of JavaScript. [Three.js point material documentation](https://threejs.org/docs/pages/PointsMaterial.html).

In that legacy implementation, each frame `updateAsteroids()` scans the discovery-sorted catalogue and calls [`Orbit.getPosAtTime()`](../../src/js/Orbit.js) for every discovered asteroid. Each call converts fixed orbital angles, solves Kepler's equation iteratively, calculates more trigonometry, and returns a new array. Positions are copied to a Float32 buffer. Both the entire position buffer and entire colour buffer are marked for upload, even when most colours are unchanged or most objects are undiscovered. `setDrawRange()` limits the submitted points; it does not restrict those full buffer uploads. Three.js supports partial update ranges and usage hints. [BufferAttribute documentation](https://threejs.org/docs/pages/BufferAttribute.html).

At one million allocated objects, those two buffers contain 24 MB, so updating both at 60 FPS would submit about 1.44 GB/s of buffer data. That is a calculation of API data volume, not a measured hardware bus-transfer rate. On this Apple Silicon machine, the **CPU orbit calculation** is the much larger measured cost.

**What PR #2 actually tests**

At the initial investigation, [PR #2](https://github.com/sn3p/Orrery3D/pull/2) was open, marked “WIP”, with a single 2018 commit (`ed79c44d344b2b14b57bf48666e4ef7c599dde08`). Its custom `ShaderMaterial` is commented out; the active code still uses `PointsMaterial` and CPU orbit calculation. The proposed shader only transforms already-calculated positions and animates a global colour. It also truncates the catalogue to 9,000 records, increases point size from 1 to 2, and assigns `THREE.Color` objects into numeric colour-buffer entries (which produces NaN values).

Consequently, that PR provides no reliable evidence for or against GPU orbit calculation. Its old Three.js r95 API also predates current master. Keep the idea, but build a fresh implementation against current code rather than treating that WIP as a performance-ready change.

**Original measured comparison (Three.js r179)**

Hardware: Apple M3 Max (14 CPU cores, 30 GPU cores, 36 GB RAM), Chrome 151, WebGL2 through ANGLE Metal. Baseline viewport: 1280 × 800 CSS pixels, DPR 1, antialiasing on, original overview camera. The date starts at catalogue epoch JED 2458600.5, after all catalogue discoveries, and advances identically for every variant.

The bundled catalogue is **100,000 actual records**, 15,059,386 bytes of JSON. Larger cases repeat those exact records and positions; they are **synthetic workload tests**, not 500,000 or one million unique asteroids. Repetition changes overlap and does not reproduce full-catalogue loading or object-memory costs. Counts below 100,000 use the discovery-sorted prefix. Counts mean submitted point primitives, including offscreen/overlapping points.

Three repetitions per case, rotating variant order and reversing count order, with 20 warm-up frames and 90 measured frames per repetition. The table reports the median of per-run FPS/median timings; the ~120 FPS entries reach this display's refresh ceiling.

| Submitted asteroids | Legacy CPU FPS | Optimized CPU FPS | GPU-orbit FPS | Legacy CPU orbit/update | Optimized CPU orbit/update | GPU-orbit GPU elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 120.0 | 120.0 | ~120 | 2.7 ms | 1.9 ms | 0.27 ms |
| 100,000 | 54.5 | 98.2 | ~120 | 18.1 ms | 10.1 ms | 0.55 ms |
| 500,000 (repeated) | 11.0 | 19.6 | ~120 | 90.1 ms | 50.9 ms | 2.17 ms |
| 1,000,000 (repeated) | 5.5 | 10.0 | ~120 | 179.5 ms | 99.4 ms | 3.67 ms |

At one million repeated asteroids, the GPU variant's full measured main-thread work was about 0.3 ms per frame (the binary search/uniform update often rounded to 0.0 ms). Its median per-run **p95 frame interval was 10.0 ms**, versus 183.4 ms for the current implementation and 108.3 ms for optimized CPU. The GPU variant reported no long tasks in these timed runs. The frozen million-point control also reached ~120 FPS with GPU elapsed time around 3.72 ms. These results identify the CPU calculation as the main bottleneck; they do not establish the maximum GPU-supported population above one million. [Raw controlled results](./results/controlled.json).

The CPU prototype precomputes the orbital orientation and ellipse axes, uses packed doubles, calculates Cartesian coordinates directly from eccentric anomaly, uploads only discovered positions, and calculates colour in the shader. It measures that bundle of changes, not the speedup of any one change in isolation.

The GPU prototype stores the same precomputed axes, eccentricity, initial anomaly, mean motion and discovery date in static attributes. Its vertex shader solves the orbit using 12 Newton iterations. JavaScript updates a relative date uniform and uses binary search to set the discovery draw range. It preserves Three.js's existing point size attenuation, output colour conversion and depth settings. The frozen control calculates asteroid positions once, then continues drawing the scene; it is a diagnostic lower-work control, not a feature-equivalent alternative.

GPU elapsed time comes from asynchronous timer queries around renderer submission, including uploads and drawing. CPU submission time is measured separately; neither is converted into a claimed user-visible FPS. Each timed run excludes setup and warm-up, retains individual frame samples and reports the 95th percentile frame interval. [WebGL timer-query documentation](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query).

**A real benchmark trap: Energy Saver**

The first runs initially reached 120 FPS, then many cases—including frozen positions—became capped at 30 FPS. The laptop was subsequently observed on battery at 19%. Chromium's Energy Saver defaults to the low-battery threshold and explicitly throttles frame sinks to 30 Hz. Disabling it only in a newly created benchmark profile restored approximately 120 FPS for the same million-point GPU workload. The timing and intervention identify Energy Saver as the explanation; the exact instant the battery crossed 20% was not logged. [Chrome performance settings](https://support.google.com/chrome/answer/12929150?hl=en), [Chromium's implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/performance_manager/user_tuning/battery_saver_mode_manager.cc).

The reported controlled runs disable Energy Saver only in their disposable browser profile, leaving normal Chrome and OS settings unchanged. The machine still runs on battery, so these are not plugged-in peak-performance claims. Ordinary refresh-rate limits remain in effect. The earlier affected run and headless control are retained as diagnostic evidence and excluded from the controlled comparison. Headless Chrome alone did not remove the cap.

Focused checks also passed:

| Scenario | GPU-orbit FPS | Median GPU elapsed | Evidence |
| --- | ---: | ---: | --- |
| 1,000,000 repeated points, overview, DPR 2 (2560 × 1600 physical pixels), three repetitions | ~120 | 3.71 ms | [Retina results](./results/retina.json) |
| 1,000,000 repeated points, closer camera, DPR 2, one repetition | ~120 | 2.21 ms | [Close-view results](./results/close.json) |
| 100,000 allocated records, 390 × 844 CSS viewport, DPR 2, reverse playback from February 1980 | ~120 | 0.30 ms | [Narrow/reverse results](./results/narrow-reverse.json) |

The reverse-playback run ended at 7,626 discovered/submitted asteroids; all three implementations reached ~120 FPS because that active population is small. This illustrates why a benchmark starting in 1980 does not test the full catalogue. The closer camera can clip more points, so it is a different workload, not evidence that zooming always makes rendering faster. These are narrow checks, not mobile-hardware benchmarks.

**Options and priorities**

| Technique | Fit for Orrery3D | Cost and tradeoff | Priority |
| --- | --- | --- | --- |
| Vertex-shader orbit calculation + discovery colour | Removes the measured per-frame CPU loop and dynamic asteroid uploads; retains one point per asteroid. Benchmarked here. | Moderate implementation effort; GPU precision, solver convergence, bounds and data validation need deliberate handling. | Implemented; see current GPU report. |
| Precomputed CPU orbital basis, packed arrays, reduced uploads | Material measured improvement; useful CPU benchmark reference and preparation shared with the GPU path. | Still O(N) CPU orbit solving per frame. Does not make a million CPU-updated asteroids smooth. | Benchmark reference; production fallback declined. |
| Pixel-ratio cap or adaptive rendering resolution | Reduces raster/antialiasing cost when resolution becomes the bottleneck. DPR 2 has four times as many pixels as DPR 1. | Softer output; should be an explicit/adaptive quality choice. It cannot cure a 180 ms CPU loop. | Add after GPU calculation, guided by GPU timings. |
| Lower-rate position calculation + interpolation | Can amortize CPU work or expensive orbit solving while rendering smooth intermediate frames. | Needs bounded visual error, special care near perihelion, and correct jumps/rewind/discovery behaviour. More state and buffers. Not benchmarked. | Consider for weaker devices if exact GPU evaluation is insufficient. |
| Spatial culling with octree, grid or BVH | Helps when large groups can be rejected before doing expensive work, or for future picking/search. | Moving points need updated bounds/indexes; GPU-only positions complicate CPU indexing. Fine partitions add draw calls and bookkeeping. Not benchmarked. | Profile a specific zoom/picking workload first. |
| Level of detail / screen-space aggregation | Can preserve the appearance of a dense belt at very large counts by aggregating subpixel points. | Intentionally stops rendering every individual asteroid; must preserve discovery totals and visual meaning. Not benchmarked. | Later, when GPU cost or visual saturation justifies it. |
| Web Workers / OffscreenCanvas / WebAssembly | Workers can keep input and GUI responsive; multiple workers or SIMD may accelerate CPU preparation/calculation. | Scheduling, buffering and data transfer remain; moving the same loop to one worker does not automatically improve total throughput. Not benchmarked. | Secondary; especially for loading/preprocessing. |
| Instancing meshes or billboard quads | Appropriate if asteroids later need larger sprites, orientation, textures or close-up geometry. | Current points are already batched. Quads/meshes add vertices and can increase pixel work; not an inherent optimization over one point per asteroid. | Keep points for the distant population. |
| WebGPU compute / Three.js TSL | Useful for GPU compaction/culling, multi-pass reuse, complex simulation and much larger future systems. | Renderer/material migration and browser/device support testing; current `onBeforeCompile` prototype is WebGL-specific. Compute is unnecessary to evaluate independent analytic orbits in one drawing pass. Not benchmarked. | Revisit after measuring the simpler WebGL shader path. |
| Binary/columnar catalogue, compression, worker parsing | Reduces loading, object allocation and preparation costs with a genuinely larger catalogue. | Requires data pipeline changes; does not itself solve steady-state orbit calculation. Not benchmarked. | Before shipping a much larger real catalogue. |

These later options are engineering recommendations from the measured bottleneck and source inspection, not measured rankings between unimplemented techniques. Supporting primary documentation: [WebGL performance guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [WebGPU capabilities and compatibility](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), [Three.js WebGPU migration constraints](https://threejs.org/manual/en/webgpurenderer).

**Where quadtrees fit**

A quadtree repeatedly divides a flat area into four regions; the analogous subdivision of 3D space is an octree. This lets a query skip entire regions, for example to find an asteroid under the mouse or avoid processing a region outside the view. A projected 2D index could be useful even in a 3D app, but would have to account for camera changes and moving objects. [D3's quadtree documentation](https://d3js.org/d3-quadtree).

Orrery3D evaluates independent, pre-defined Keplerian orbits. It does **not** calculate forces between every pair of asteroids. Barnes–Hut trees accelerate that many-body force problem; they do not remove the independent orbit solves in this app. [NVIDIA's explanation of many-body algorithms](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda).

For the whole-belt overview, a spatial index may reject little work. If positions must first be calculated on the CPU to rebuild that index, the dominant cost has already been paid. Conservative bounds on whole orbits avoid per-frame rebuilding but can span much of the scene and cull poorly. GPU culling can avoid later raster work, but deciding visibility still requires calculating a position. These are reasons to measure a specific culling case later, rather than add a tree as the first optimization.

**Historical correctness checks and integration checklist**

The benchmark checks every real catalogue orbit at five dates spanning 1801–2100: 500,000 GPU/CPU comparisons. No non-finite outputs were observed. The optimized CPU maximum position difference from the original calculation was about `2.7e-10` world units. The GPU maximum was about `0.0237` world units (100 units = 1 AU); maximum error for on-screen asteroids in the 1280 × 800 overview was about **0.0153 CSS pixels**. This is sufficient for that tested view, not an astronomical-accuracy guarantee or an extreme-zoom guarantee.

The actual rendered materials were also compared in a multisampled render target, including overview, closer camera and an earlier discovery date. CPU output matched the baseline pixels exactly in those checks. GPU mean channel differences were under 0.002 on a 0–255 scale. Discovery counts, submitted point counts, forward/reverse date transitions, pause, empty state and colour boundaries were exercised. The catalogue contains elliptic orbits with maximum eccentricity about 0.961. A future catalogue with near-parabolic, hyperbolic, non-finite or otherwise invalid elements needs explicit data validation and convergence checks. Production now rejects unsupported elements and uses extra iterations for e ≥ 0.99; it does not fall back to CPU rendering.

The original integration checklist follows. Items 1–4 and the context-recovery/browser portion of item 5 are now implemented and tested in the [GPU integration](gpu-renderer.md); genuinely larger catalogues and other hardware remain deferred:

1. **Decouple simulated date from FPS.** The original production code added `jedDelta` once per frame. A performance improvement therefore also speeds up history playback. Define speed in days per real second, use elapsed time, and handle tab suspension deliberately. Benchmark variants intentionally use identical per-frame dates for comparison. [Animation timing guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
2. **Use relative/rebased time.** Do not pass a full ~2.45-million Julian date as a Float32 uniform: its spacing is roughly 0.25 days. This prototype subtracts an epoch before uploading; test/rebase longer time spans and closer views.
3. **Finish the discovery lifecycle.** The original production code stopped updating a colour after it crosses the fade cutoff, so it can retain its last slightly green colour; reverse/jump history can retain stale values too. The benchmark reproduces the cutoff issue and the prototypes derive a clamped colour directly from date. Promote this into production regression coverage with any integration.
4. **Provide correct moving-object bounds.** The original CPU positions moved without recomputing their cached bounding sphere. GPU positions likewise cannot use a zero-filled CPU position attribute as a bound. The prototypes disable asteroid-object frustum culling; a production implementation can use conservative orbital bounds. Verify panning, discovery growth and zoom. [Three.js bounding-sphere responsibilities](https://threejs.org/docs/pages/BufferGeometry.html).
5. **Validate the real larger catalogue and supported devices.** Measure load/parse/preparation time, memory, context loss/recreation, Safari/Firefox, integrated/mobile GPUs, and extreme views. The GPU prototype trades static attribute memory (roughly 52 bytes/object including its dummy position attribute) for eliminating repeated uploads; it also retains CPU data and preparation buffers. It is not a memory-optimized final implementation.

**What carries over to 2D Orrery**

**Yes: GPU orbit calculation is a strong optimization candidate for 2D Orrery too.** A vertex shader can calculate positions for a 2D visualization; the technique does not require a 3D scene. This conclusion is supported by source inspection, while the size of the benefit in Orrery remains unmeasured.

Read-only inspection of Orrery master, rechecked at `c53a9488f034c689239861c1a2d0aa564170ba0c`, shows a Pixi `ParticleContainer` and a particle object per asteroid. During playback, `tick()` calls `asteroid.render(jed)` for each active asteroid; `renderPosition()` calls the JavaScript orbit solver and assigns the result to the particle's `x` and `y`. Thus the same category of per-asteroid CPU work is present. Its share of 2D frame time still needs profiling. [Orrery renderer](https://github.com/sn3p/Orrery/blob/c53a9488f034c689239861c1a2d0aa564170ba0c/src/js/Orrery.js), [asteroid implementation](https://github.com/sn3p/Orrery/blob/c53a9488f034c689239861c1a2d0aa564170ba0c/src/js/Asteroid.js).

The analogous optimization would upload orbital parameters once, calculate the current position in a vertex shader, and update date/discovery state from JavaScript. Pixi already provides efficient particle drawing, but that does not automatically move application orbit calculations to the GPU. A custom batched mesh/shader within Pixi is a candidate integration route; switching the entire application to Three.js is unnecessary. Pixi's mesh API exposes custom geometry and shaders, and its particle API distinguishes static attributes from attributes uploaded each frame. [Pixi mesh documentation](https://pixijs.com/8.x/guides/components/scene-objects/mesh), [particle documentation](https://pixijs.com/8.x/guides/components/scene-objects/particle-container).

| Part | What transfers from the 3D investigation | What must be verified for 2D |
| --- | --- | --- |
| Orbit calculation | Precomputed orbital basis, relative time, GPU Kepler solver and numerical reference checks. | Orrery returns mirrored X and Y from its inclined orbit; preserve those conventions and its pan/zoom transforms. |
| Rendering | Static per-asteroid data and a small per-frame date update. | Pixi geometry, shader bindings, texture sampling and blending. Sprite quads can require more vertex/fragment work than the 3D point primitives. |
| Discoveries | Sorted dates, efficient visibility/count updates, forward/reverse boundary tests. | Preserve 2D's large green discovery marker, shrink animation and eventual grey colour. Its current effect is frame-based and differs from 3D's gradual colour fade; choose any timing change deliberately. |
| CPU alternative | Precompute constants, pack data and avoid temporary per-frame objects. | Orrery currently uses fixed-point iteration (`E = M + e * sin(E)`), whereas Orrery3D uses Newton's method. A validated Newton solver is another candidate to benchmark, particularly for high eccentricities. |

The [2D orbit source](https://github.com/sn3p/Orrery/blob/c53a9488f034c689239861c1a2d0aa564170ba0c/src/js/Orbit.js) confirms the coordinate and solver differences. The 3D shader is therefore a useful mathematical starting point, with a Pixi-specific rendering implementation and separate behaviour tests. No 2D FPS improvement is claimed from the 3D measurements.

Recommended 2D follow-up: benchmark the current ticker, an optimized CPU solver, a GPU-orbit batch and a frozen-position drawing control at equal counts, dates and viewport settings. Include pan/zoom, pause, forward/reverse discoveries, marker size/colour transitions, and a real larger catalogue. Quadtrees remain a later candidate for picking or culling if those operations become measured bottlenecks. No 2D application code was changed during this investigation.

**Artifacts and reproduction**

Run `npm ci && npm run benchmark`, or use `npm run benchmark:serve` for an interactive comparison. [Benchmark instructions and methodology](../../benchmarks/README.md) document all options. Raw controlled results, diagnostics, focused cases and retained screenshots are in [the results directory](./results/). Those original investigation runs did not change production source or `dist/`. Subsequent GPU integration updates both; the old PR itself remains untouched.

Original investigation verification: three controlled repetitions across four counts and four variants (48 timed cases); 12 Retina cases; four closer-camera cases; three narrow/reverse cases; GPU/CPU numeric and actual-material pixel comparisons; discovery/fade boundary checks; inspected screenshots at desktop, Retina and narrow sizes; zero browser errors in those runs. The production build passed with existing bundle-size/Browserslist-data warnings, writing output to `.context/benchmark/production-build` so tracked `dist/` remained unchanged. The complete working diff was checked for whitespace and unintended production changes.

Still deferred: a million **unique** current MPC records and their startup/memory cost, arbitrary orbital elements, extreme camera positions, other GPUs and actual mobile devices. Production integration, camera interactions, graphics recovery and additional browser engines are covered in the [current implementation report](gpu-renderer.md). None of the other unimplemented techniques in the comparison table has been benchmarked. No 2D parity implementation is claimed.
