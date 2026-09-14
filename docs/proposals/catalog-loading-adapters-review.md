# Review: catalog source adapters for Orrery3D

**Reviewed:** [catalog-loading-adapters.md](catalog-loading-adapters.md), 13 September 2026.
**Basis:** Orrery3D master `1e2bea1964953a5bbed7e23ec9a60b01b9c125e1`, producer contract v1 at `f6f4a1d4e807362417c74ecbd2b74ce73306d41d`, the Pages workflow, and the prior investigation and Pages follow-up reports retained in local feature memory.
**Review goal:** keep the design simple but solid, and make sure it works on GitHub Pages.

## Summary

The proposal is technically sound. The data format, the source interface and the deferrals are right. The consumer side, however, describes a streaming-data platform for an app whose whole runtime is under 900 lines. It can be cut to roughly a third of what is written without losing correctness, and one GitHub Pages constraint that is missing from the proposal decides the design on its own.

## Findings

### 1. The A/B trial is already decided by the proposal's own numbers

The whole-file path is today's code. It has already been measured on the full catalog: 118.8 MB decoded, about 339 MB of JavaScript heap, and main-thread tasks of 349 ms and 177 ms. A single `JSON.parse` of a 119 MB string is inherently the problem, and no adapter wrapper changes that.

Building a second formal whole-file adapter to re-measure this adds code that will never ship.

**Suggestion:** treat the current boot path as the baseline, build only the indexed loader, and compare against the numbers already recorded in the investigation report. Stage 4 becomes "measure indexed loading on the full bundle" rather than a two-source comparison.

### 2. The whole catalog cannot be committed for Pages

The decoded full catalog is 118,824,557 bytes, above GitHub's 100 MiB per-file limit. Today `data/catalog.json` is a tracked webpack asset and `dist/` is tracked too. Neither pattern can carry the full catalog.

This means "hosting follows separately" is not a separable question for this app. The bundle has to be downloaded and verified in the Pages build job and copied into `dist/` before upload. Without that step, nothing else in the proposal can be deployed.

**Suggestion:** make CI provisioning stage 1. A small Node script downloads the pinned `index.json` and chunks from a release URL, checks each SHA-256 against the index and the trusted index pin, and writes them under `dist/data/`. Untrack `dist/` in the same change; the workflow already builds from source with `--output-clean`. Until a public release URL exists, the same script can copy from a local path for development.

### 3. Pages compression is already verified

A live request to the deployed catalog returns `content-encoding: gzip` with a compressed body of about 4 MB for the 15 MB source file. Pages compresses JSON transparently, and `fetch` decodes it before the adapter sees the bytes.

**Suggestion:** ship plain `.json` chunks only. Drop the explicit `.gz` path, its stored-representation hash and the double-decompression rules from the trial entirely.

### 4. Chunked loading has a Pages-specific upside the proposal does not state

The Pages soft bandwidth limit is 100 GB per month. A full run costs about 34 MB either way, so at most roughly 2,900 full runs a month. A short visit in indexed mode costs under 1 MB instead of 34 MB. For a site on Pages that is the strongest argument for the indexed source, and it should be in the decision criteria.

### 5. The loader is over-engineered for how the data is shaped

Visible objects are always the ordinals from zero through `countThrough(T)`. The catalog is stored in that same order. So committed coverage can always be a single prefix, and there is never a legitimate gap.

**Suggestion:** load chunks strictly in ordinal order with two requests in flight. Playback holds only when the required count exceeds the committed count. This removes:

- interval and coverage tracking,
- gap and duplicate handling,
- equal-date splitting logic (just wait until committed count is at least `countThrough(T)`),
- cancellation isolation between overlapping reads (there is one sequential reader),
- out-of-order and duplicate arrival handling.

Reverse movement, later start dates and forward jumps all work for free, because the prefix is retained and a jump simply waits for the prefix to reach the new requirement.

Replace the speed, density and throughput based lookahead with a fixed rule: keep fetching while committed coverage is fewer than about three chunks past the current requirement, and stop while paused or hidden.

Generation tokens are only needed if the source can be replaced at runtime. The proposal already keeps the adapter selector out of the UI, so one source per page load and one `AbortController` for disposal is enough.

### 6. Preallocate the GPU buffers for the full selected population

The index gives the total count at open time. The proposal forbids preallocation to avoid claiming a false memory benefit, but the benefit of chunking was never the typed arrays. It is avoiding the 119 MB string and the parsed object tree. Preallocation is a fixed, honest cost and removes capacity growth, buffer copies, overlapping allocations and the whole bounded-block alternative.

| Preallocated for 895,910 records | Size |
| --- | ---: |
| GPU attributes (p, q, elements, meanAnomaly, discovery), 40 bytes per record | ~36 MB |
| CPU mirrors of those attributes kept by Three.js | ~36 MB |
| Float64 phases and dates, 24 bytes per record | ~22 MB |
| Observed heap today with the whole file | ~339 MB |

Upload new ranges with `BufferAttribute.addUpdateRange` and keep using `setDrawRange`. The binary search in `Asteroids.update()` runs over the committed count instead of the array length. Grow the bounding sphere as batches arrive. The shader does not change.

### 7. Defer the worker until a measurement demands it

A 1 MiB chunk holds about 7,900 records. Parsing and preparing that on the main thread should take well under one frame, and `SubtleCrypto.digest()` is already asynchronous and native. The chunking itself bounds the stalls that the worker was meant to hide.

Two further notes:

- `webpack.config.js` sets `chunkFormat: false` and `splitChunks: false`, so it emits a single bundle. A `new Worker(new URL(...))` needs webpack to emit a separate file, which will need a config change and a check under the `/Orrery3D/` subpath.
- If measurements later show loading tasks above roughly 50 ms, add the worker then. The preparation seam is already pure and transferable.

### 8. Epoch alignment needs five lines, not a policy

Prepare each batch with the cloud's current epoch. On commit, if a phase refresh happened between dispatch and arrival so that the batch epoch differs from the cloud epoch, rephase just that range from the stored phases. That is the same loop `Asteroids.update()` already runs for a refresh.

### 9. Keep the contract interface, implement one class

`open`, `countThrough`, `read` and `close` are small and match the producer contract, so keep them. The whole-file case is the indexed adapter with a one-entry chunk table built from the index's `full` descriptor. If the baseline is ever wanted through the same interface, that is a few lines rather than a second module and a second cache.

### 10. Use the pinned bundle directory in URLs

Pages caches with `cache-control: max-age=600` and allows no custom headers. Serving under `data/delivery-v1-<index sha256>/` guarantees an old index is never combined with new chunks after a deploy, and gives free cache busting.

### 11. Shrink the verification matrix

The proposal asks for three browsers, several network profiles, three runs per scenario and an independent review. This decision does not need that.

**Suggestion:**

- Run the two committed producer fixtures (`ties`, `empty`) and their request vectors through the real adapter in Node. Node 24 has `fetch` and `crypto.subtle`, so these can be fast `.cjs` tests like the existing ones.
- Add one Playwright regression in the existing runner covering boot, a buffering hold, reload and context loss with the small fixture served locally.
- Do one recorded desktop Chrome measurement on the full retained bundle, at native and one throttled network profile, and compare with the investigation report numbers.

### 12. Set provisional budgets now

The proposal leaves absolute budgets open. Pick provisional ones so the measurement has a pass mark:

- initial February 1980 scene complete within about two seconds on a 10 Mbps, 100 ms profile,
- no main-thread task above 50 ms during loading,
- JavaScript heap under about 150 MB after the full catalog is committed.

They can be revised, but the proposal should not defer them to a later decision.

## What to keep as written

- The source interface and Julian-day boundary.
- Index verification before use and SHA-256 verification of each decoded chunk. For 1 MiB this costs a few milliseconds and catches truncated or corrupt responses. CI verification remains the real integrity gate.
- The current 100k catalog as a regression control without producer provenance.
- Deferral of date controls, undated objects, a shared browser package and any service backend.
- Reconciling with [PR 28](https://github.com/sn3p/Orrery3D/pull/28) first, since it touches `Orrery3D.js`, the test runner and benchmark files.

## Proposed reduced stages

| Stage | Result |
| --- | --- |
| 1. Provisioning and contract | CI script downloads and verifies the pinned bundle into `dist/data/`; `dist/` untracked; index validation and `countThrough` with fixture tests in Node. |
| 2. Indexed source and prefix loader | One adapter class, sequential prefix loading with a fixed lookahead, preallocated buffers with ranged uploads, buffering hold in `Orrery3D.js`. |
| 3. Regression and measurement | One Playwright workflow on the small fixture; one recorded full-bundle measurement against the provisional budgets. |
| 4. Decision | Adopt indexed loading as the Pages default, or record which budget failed and whether a worker or smaller chunks would fix it. |

## Open questions for the author

1. Where will the pinned bundle be hosted for CI download: a GitHub Release on `orrery-data`, on `Orrery3D`, or elsewhere? This blocks stage 1.
2. Is the 1 MiB decoded chunk cap the right size for Pages, or would 2 to 4 MiB reduce request count without hurting startup? The index supports up to 8 MiB.
3. Should the deployed Pages default switch to the full 895,910-record catalog once the budgets pass, or stay on 100k for a first release?
