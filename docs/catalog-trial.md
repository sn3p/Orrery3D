# Local catalog adapter trial

The normal app and Pages workflow continue to use the historical 100,000-object
catalog. This development trial accepts producer contract v1 bundles in either
`indexed` or `whole` mode. It adds no catalog/date controls and excludes objects
without discovery dates. The [approved design](proposals/catalog-loading-adapters.md)
and [review response](proposals/catalog-loading-adapters-review-response.md)
record the scope.

## Prepare and run

Use the project's Node version and run `npm ci`. Obtain the original, complete
indexed bundle and its trusted pin from the
[producer handoff](https://github.com/sn3p/orrery-data/blob/f6f4a1d4e807362417c74ecbd2b74ce73306d41d/docs/consumer-handoff.md).
There is no public indexed release URL yet. Keep the original `full/`, `chunks/`
and `index.json`; transferring only runtime JSON files is insufficient for
this bundle's provisioning check.

Save a machine-local configuration as `.context/catalog-config.json`:

```json
{
  "bundle": "/absolute/path/to/delivery-v1-bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2",
  "pin": {
    "url": "index.json",
    "bytes": 265372,
    "sha256": "bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2"
  },
  "mode": "indexed",
  "startJed": 2444270.5,
  "speed": 1.5
}
```

The pin selects 895,910 dated objects in 114 chunks. `startJed` is February 1,
1980 at midnight under the contract's Julian-date convention, independent of
browser timezone. `speed` uses the existing scale (1 = 60 days/second).
Relative bundle paths resolve against the configuration file.

```sh
npm run catalog:build -- .context/catalog-config.json
npm run catalog:serve
```

Open the printed URL. The server binds to localhost on port 3002; set `PORT` to
choose another available port. It serves HTTP gzip for JSON/app assets, including
the original catalog sidecars. Change mode to `whole` and rebuild for the
comparison. Rebuild and restart the server after source/config changes; this
trial server does not watch and caches compressed app assets for its lifetime.
The normal `npm run serve` still runs the historical app.

## Data flow and verification

1. The local provisioner verifies the trusted index before using its references.
   It validates bundle inventory, every hash/length, gzip/decoded agreement,
   export metadata, notices and checksums.
2. It stages files in `.context/catalog-cache/delivery-v1-HASH/`, repairing a
   damaged generated cache only after its replacement has been verified.
   Webpack makes a clean source build in `.context/catalog-site/`.
3. Original files are copied to the site's `data/delivery-v1-HASH/` **after**
   cleaning and verified again. Data and generated output stay outside Git.
4. At runtime, `CatalogSource` verifies the index and each decoded JSON file.
   `countThrough(T)` includes all discoveries at `disc <= T`; ordered range reads
   preserve every original row. Both modes share verification and source identity.
5. `CatalogLoader` commits an ordered prefix into fixed-capacity attributes.
   Initial demand gets priority; after the first complete draw, playback permits
   at most three extra chunks. At most two file-processing slots are live,
   including finished results awaiting commitment. Pause/hidden cancels
   unnecessary lookahead.
6. An incomplete future population holds the last complete date without changing
   speed. Recovery resets elapsed-time accounting. Required reads survive a pause
   that removes only lookahead. Exhausted speculative reads can recover when
   their records become necessary, on resumption, or when connectivity returns.
   Preparation errors have distinct status and are not retried as downloads.
   Reverse uses retained arrays, and graphics restoration uploads those arrays
   again; graphics commitment requires an actual asteroid render callback.

Indexed mode bounds transient file/record memory. Both modes preallocate the
entire population: **57,338,240 CPU bytes plus 35,836,400 GPU bytes** for this pin,
before app/temporary allocations. Three.js uploads full attribute arrays on
first use; subsequent append uploads use component ranges. Preparation stays on
the main thread. File parsing and consumer preparation run in separate tasks,
with the processing slot held across both, after a repeat exposed a combined
58 ms task. Browser task boundaries use posted messages to avoid timer clamping.
Preparation and buffer commitment remain synchronous at the same epoch. A worker
remains a later option if individual operations exceed the budget.

`npm test` exercises producer request/error vectors and the real browser
loader: ties, cancellation, replacement, buffering, retries, empty profiles,
reverse, disposal and graphics recovery. The existing three-browser regression
workflow remains. Small fixtures need no producer installation or downloaded data.

## Measurements

See the [trial results](catalog-trial-results.md) for measured outcomes and remaining rollout checks.
The [implementation review response](catalog-trial-review-response.md) records
the subsequent correctness and recovery fixes.

```sh
npm run catalog:benchmark -- .context/catalog-config.json
```

The benchmark builds the configured app with an inspection wrapper, then uses
fresh Chrome contexts at 1280×800, DPR 1, native networking and 10 Mbps/100 ms
throttling. It records first correct GPU draw, timed playback, 30/60/120-second
transfer, a separate final-date jump, retained/sampled peak memory, loading
operations, long tasks and full-population rendering. Stop other rendering
workloads while measuring.

Use `PROFILES=10mbps-100ms DURATION_SECONDS=0` for an initial-draw/late-jump
exploration, and `OUTPUT=...` to retain separate reports. Default timed playback
is 120 seconds; the subsequent jump is explicitly reported, not described as
continuous replay. Reports go to `.context/catalog-trial/measurements.json`.

`initialSubmissionMs` records renderer return; `initialMs` waits for a WebGL
fence after that complete scene. Neither measures compositor presentation.
Memory uses CDP `usedSize + backingStorageSize` after forced collection, with GPU
storage separate. Samples around 250 ms apart provide a **lower bound** on peak
memory and can miss synchronous allocations. A catalog-associated long task
overlaps a measured operation; not every millisecond belongs to that operation.

The origin counts encoded response bodies it writes, including speculative and
aborted work. CDP figures are retained separately; cancellation can make its
gzip accounting incomplete. Origin-body counts exclude HTTP headers, and
emulated delivery can reach the browser later than the origin writes it.
These local results do not establish actual Pages delivery or phone performance.

## Before public rollout

A public immutable source, Pages retrieval/assembly job, hosted compression and
failure checks, and prior-version retention/rollback need separately scoped work.
The existing Pages job has no placeholder release dependency and does not enable
the trial. To verify assembly locally in the normal output directory:

```sh
npm run catalog:build -- .context/catalog-config.json dist
```

This replaces local generated `dist/`; `npm run build -- --output-clean` restores
the historical build. It does not deploy. A public switch requires the measured
acceptance decision; the producer merge alone does not authorize it.
