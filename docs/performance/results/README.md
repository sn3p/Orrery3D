# Retained benchmark evidence

See [the investigation](../investigation.md) and [runner methodology](../../../benchmarks/README.md).

Saved JSON is compacted to keep generated samples out of the line-by-line source diff. All fields and samples are preserved; the runner writes formatted JSON when reproducing a run.

| File | Interpretation |
| --- | --- |
| `gpu-integration.json` | Actual production GPU integration on Three r186, compared with the frozen legacy CPU implementation and CPU prototype. Three repetitions × 100k/1m, 90 measured frames after 20 warm-up frames, DPR 1. Includes production-buffer precision checks across rebases and separately forced phase-refresh costs. |
| `gpu-integration-retina-close.json` | Focused production GPU check at 1m repeated points, closer camera and DPR 2; one repetition, 60 measured frames after 20 warm-up frames. |
| `gpu-integration-browser-tests.json` | Production browser regression results and source fingerprints for Chrome, Firefox and WebKit. Correctness checks, not performance samples. |
| `after-dependency-update.json` | Three.js r186 after merged dependency PR #8; 3 repetitions × 100k/1m × baseline/CPU/GPU, 90 measured frames after 20 warm-up frames, DPR 1. Full numerical/discovery/rendered validation passed after correcting the prototype's RGBA varying. Plugged in; keep separate from the original battery-powered results. |
| `controlled.json` | Original r179 primary result: Energy Saver disabled in a disposable profile, 3 repetitions × 4 counts × 4 variants; 90 measured frames after 20 warm-up frames. |
| `retina.json` | DPR 2 overview, GPU/frozen at 100k/1m, 3 repetitions; 120 measured frames after 30 warm-up frames. |
| `close.json` | DPR 2 closer camera, GPU/frozen at 100k/1m, 1 repetition. |
| `narrow-reverse.json` | 390 × 844 CSS viewport, DPR 2, reverse playback from 1980, 100k allocated records; about 8k discovered. |
| `energy-control.json` | Diagnostic intervention: fresh profile with Energy Saver disabled restored ~120 FPS at 1m; GPU/frozen control. |
| `main.json` | Earlier run affected by Energy Saver: initially ~120 FPS, later 30 FPS cap even for frozen positions. Excluded from primary performance table. |
| `headless-check.json` | Earlier hardware-backed headless check with default Energy Saver, also capped at 30 FPS. Excluded from primary performance table. |

Benchmark JSON files retain per-frame samples. `sourceCommit` identifies the committed base; the integration changes were uncommitted when measured. `gpu-integration.json` fingerprints the actual production asteroid/clock/app sources as well as the harness. Its HTML caption was subsequently clarified from “Current renderer” to “Legacy CPU”; the measured JavaScript is unchanged. The integration files and `after-dependency-update.json` use base `b12721a` (r186); the original files describe `283ec41` (r179). Controlled/focused results also fingerprint the benchmark source. The older diagnostic runs predate the additional actual-material pixel checks; the maths/discovery checks were already present. Do not pool differently configured runs.

Two representative **static previews of the 100,000-record catalogue** are retained: [production overview](gpu-integration-gpu.png) and [production Retina/close view](gpu-integration-retina-close-gpu.png). They are not timing captures; measured FPS and pixel comparisons are in the JSON. Older and repeated CPU/GPU previews are omitted from the repository. The runner still generates each variant's PNG when reproducing a comparison.

Previews capture just the canvas synchronously with rendering. This avoids a delayed page screenshot reading WebGL's non-preserved drawing buffer; canvas pixel comparisons additionally verify GPU-to-CPU transitions.
