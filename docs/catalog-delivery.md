# Catalogue delivery

The ordinary application selects the **895,910-object indexed catalogue** in
`catalog.config.json`. There is no 100,000-object cap; the displayed count is the
population discovered by the current simulation date.

The current branch uses the verified bundle already provisioned in
`.context/catalog-downloads/`. **Fresh-checkout/CI provisioning is still incomplete.**
This relative local source must be replaced by a source available to a fresh build.
The build fails if its selected source is missing; it never silently restores the
historical catalogue.

## Current delivery direction

The user clarified on 14 September 2026 that the application should use the latest
processed dataset, manual refresh/build triggers are acceptable, and maintaining
versioned data releases is not a requirement. The earlier immutable-release and
multiple-version retention proposal is no longer a mandatory rollout step. No
GitHub data release has been created.

The user now prefers **one producer-owned data host**. The proposed follow-up is
to update the current generated browser chunks and index in `orrery-data` only
when their content changes, and serve them from that repository's static site.
Consumer apps would discover the current dataset and request chunks directly at
runtime, rather than copy the dataset into each app deployment. A manual producer
update followed by a consumer reload is sufficient; no app rebuild should be
required merely to select newly published data.

The original 114 plain JSON chunks total 118,824,783 bytes; no chunk exceeds
1 MiB. A browser distribution needs roughly 119 MB of chunks/index plus small
notices and provenance, rather than the entire 399 MB producer inventory. Git
reuses identical content, but retains previous changed contents in history.
Source corrections and byte-based chunk boundaries can change many files; update
only differing files without promising that every refresh changes just one chunk.

This smaller browser distribution is **not implemented yet**. The current complete-
bundle verifier also requires the full exports, gzip sidecars and master. A separate
verified browser-distribution path must be implemented and tested; do not simply
remove those files or skip verification. Preserve integrity checks and let each
consumer session open one coherent current dataset. Latest-data selection does not require the
browser to mix old and new chunks while an update is being published.

Producer changes belong in a fresh `orrery-data` review unit. This preference does
not change another application's implementation or authorize publication, a merge,
or removal of previously retained evidence. The implemented archive and retention
options below describe available tooling, not required product behavior.

## Mode options

| `mode` | Catalogue and loading behavior |
| --- | --- |
| `indexed` | Default. Loads the selected larger catalogue in verified chunks as the simulation needs them. |
| `whole` | Loads the same selected larger catalogue as a single complete JSON file; useful for comparison. |
| `historical` | Loads the old checked-in 100,000-object file; explicit rollback/comparison only. |

`indexed` and `whole` require a complete bundle source and an index pin. Neither
imposes a record limit. `historical` accepts `mode` and optional `retained` only.

## One selection for normal commands

`npm run build`, `npm run serve` (including Conductor Run App), and `npm run watch`
read the tracked `catalog.config.json`. The existing Pages workflow calls that same
build command. A local `CATALOG_CONFIG` environment variable can select another
configuration for development or verification. An explicitly selected missing or
invalid configuration fails; it never falls back to the historical catalogue.
The small test fixtures remain self-contained and do not acquire the full dataset.

For local preparation, save this configuration outside Git, for example as
`.context/catalog-config.json`, with the actual complete bundle directory:

```json
{
  "mode": "indexed",
  "bundle": "/absolute/path/to/the/retained/complete/bundle",
  "pin": {
    "url": "index.json",
    "bytes": 265372,
    "sha256": "bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2"
  }
}
```

```sh
CATALOG_CONFIG=.context/catalog-config.json npm run build -- --output-clean
CATALOG_CONFIG=.context/catalog-config.json npm run serve -- --no-open
CATALOG_CONFIG=.context/catalog-config.json npm run watch
```

Relative bundle paths resolve against the configuration file. Normal configured
commands preserve the app's browser-local February 1, 1980 starting date and speed
1.5. Optional finite `startJed` and `speed` fields override them explicitly.
The separate `catalog:build`/benchmark commands retain their original trial
settings: JD 2444270.5 (February 1, 1980 **UTC**) and speed 1.5. `whole` remains an
explicit comparison mode. A failed indexed read never selects whole mode.

Development and watch keep one verified selection for the process lifetime;
restart after changing configuration or choosing a different pin. Source edits
recompile normally. App assets can live in webpack's memory filesystem; verified
data is staged in `dist/data/` and served from the static root. Configured
serve/watch reject output/static-root overrides, so the cleaner cannot reach an
input bundle and the data cannot become disconnected from its serving path.

## Immutable acquisition

A configuration accepts exactly one `bundle` directory or `archive` object.
An archive requires a real explicit HTTPS `url`, positive `bytes` and lowercase
SHA-256 `sha256`. HTTP is permitted only on localhost for transport tests. At most
five redirects are followed, with every destination checked against the same URL
policy before requesting it; the timeout covers the entire redirect chain and body.
The independent `pin` always identifies the original decoded `index.json`. No `latest`
lookup or upstream MPC refresh is performed. Do not put a guessed future URL into
the tracked selection, or put a developer's local bundle path into CI.

This consumer transport container is a `.tar.gz` holding the complete original
producer bundle **at its archive root**: `index.json`, `full/…`, and `chunks/…`.
It is not the producer's separate SQLite release schema. Preserve every original
file, checksum, sidecar, master and notice. There is no runtime projection or
rewritten index. Only regular-file entries are accepted; no wrapper directory,
links, duplicate entries or unrelated files. Expanded input is bounded to 1 GB.

A local archive can be prepared without publishing data:

```sh
node scripts/catalog.cjs pack .context/catalog-config.json .context/catalog.tar.gz
```

The command refuses to overwrite an existing file and prints archive/index pins.
It packages the verified inventory using portable tar metadata and omitted mtimes.
Consumers pin the finished archive bytes; reproducibility across future library
or compression versions is not assumed. The original bundle verifier runs before
packaging, after transfer/extraction, during cache staging and on deployment files.

Remote acquisition streams into private temporary storage, enforces the pinned
archive size/hash before extraction, and verifies the complete extracted bundle.
A warm, fully verified `.context/catalog-downloads/` cache works offline. A damaged
cache is repaired only from verified replacement input. Missing, truncated,
wrong-hash or incompatible downloads fail without replacing a usable cache or
production output. `.context/catalog-cache/` is the separate verified build input.
Both caches are generated conveniences; neither is a release-retention policy.

## Assembly, retention and rollback

Configured production builds compile into a private sibling directory, then
stage and verify all selected/retained bundles **after** webpack cleaning.
Only a complete successful assembly replaces `dist/`. Compilation and final-copy
failure leave the previous output intact. Competing builds for the same output
fail with a lock message. A killed build can leave `dist.build-lock/`; after
confirming no writer is active, inspect its `site/` and `previous/`, restore the
previous output if needed, then remove that interrupted lock. Do not remove a
live lock. This local directory replacement is not a running HTTP server's atomic
release mechanism; Pages publishes the completed artifact separately.

Optional `retained` entries each specify their own `pin` plus `archive` or local
`bundle`. Every build reacquires or verifies them and stages their original
`data/delivery-v1-HASH/` paths. They are explicit inputs, never discovered by
copying arbitrary old cache directories. The historical `data/catalog.json`
continues to be emitted because existing clients and regression controls use it.

For rollback between indexed pins, change the selected pin and keep both the
previous and newer pins in the deployment's retained set as needed. To restore
the historical app while preserving indexed clients, select:

```json
{
  "mode": "historical",
  "retained": []
}
```

**Fill `retained` with the real pinned bundle descriptors before rolling back an
indexed deployment.** An empty array retains no indexed versions. A bare historical selection drops all indexed bundles and is unsuitable for
rollback while indexed clients may still be open. Git history preserves selection records; durable published archives
must preserve the referenced bytes. Expiring Actions artifacts are insufficient.

Prepared sites are limited to 900 MB of regular-file content, leaving headroom
under Pages' current 1 GB site limit. The known bundle is 398,669,815 bytes; two
such bundles plus the app/historical asset fit, while three do not. This is a
bounded retention design: clients referencing omitted older versions may fail and
need reload. Multiple-version retention is optional under the current latest-data direction.
Do not describe two bundles as unlimited stale-client compatibility. The smaller
browser distribution still needs an explicitly tested implementation.
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Remaining delivery work

1. Implement the smaller verified browser distribution, content-aware manual
   update path and shared static hosting in `orrery-data`. Consumer apps should
   fetch the shared dataset directly; no release archive or per-app data copy
   is required by the user's preference.
2. Give consumers a tested current-index discovery contract and real hosted
   endpoint. Replace the temporary local source through the appropriate consumer
   review unit. Verify clean builds without the local data cache, failed-update
   preservation and consistent index/chunk selection during refresh. Do not
   invent a remote URL or silently change the existing pin contract.
3. Verify the resulting Pages artifact and an authorized hosted candidate at the
   real `/Orrery3D/` paths: reload, fonts, index/chunks, decoded hashes, status,
   gzip and cache behavior. A stale open page must recover clearly when its
   dataset is replaced; indefinite old-version availability is not a requirement.
4. Complete the remaining full-data/device acceptance from the
   [rollout handoff](catalog-trial.md#before-public-rollout). Physical-phone
   performance and maximum-speed buffering/late-start costs remain unverified
   rollout details; the user has confirmed the current local app works.

`npm test` covers archive transport, corruption/cache repair, failed builds,
retention through HTTP requests, historical rollback, actual normal build/dev/watch
commands, and the configured browser entry under a nested path. The existing
three-browser loader/graphics/lifecycle suite remains in place. These checks use
fixtures; full-data and hosted evidence must be reported separately.
