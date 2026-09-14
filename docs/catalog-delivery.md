# Catalogue delivery

The ordinary application selects the **895,910-object indexed catalogue** in
`catalog.config.json`. There is no 100,000-object cap; the displayed count is the
population discovered by the current simulation date.

The current branch uses the verified bundle already provisioned in
`.context/catalog-downloads/`. **Fresh-checkout/CI provisioning is still incomplete.**
This relative local source must be replaced by the published shared `latest` URL.
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

The producer is implementing this smaller browser distribution. This app now
supports its separately versioned browser contract and `latest.json` discovery.
The complete-bundle verifier remains separate and still requires the original
full exports, gzip sidecars and master. Each browser session opens one verified
index and validates its chunks. Missing or corrupt chunks stop loading and show
a reload message; reloading opens the current dataset without an app rebuild.

Producer changes belong in a fresh `orrery-data` review unit. This preference does
not change another application's implementation or authorize publication, a merge,
or removal of previously retained evidence. The implemented archive and retention
options below describe available tooling, not required product behavior.

## Mode options

| `mode` | Catalogue and loading behavior |
| --- | --- |
| `indexed` | Default. Loads the selected larger catalogue in verified chunks as the simulation needs them. |
| `whole` | Loads the same selected larger catalogue as a single complete JSON file; useful for comparison. |

`indexed` accepts a shared `latest` URL or a complete bundle and index pin.
`whole` requires a complete bundle; the shared browser distribution has no
whole-file payload. Neither mode imposes a record limit. Other mode values are rejected.
Indexed builds do not emit the historical catalogue.

## Shared runtime source

The producer's planned endpoint is shown below. It must be published and verified
before this replaces the current tracked local selection:

```json
{
  "mode": "indexed",
  "latest": "https://sn3p.github.io/orrery-data/latest.json"
}
```

This configuration builds only the app. Build, serve and watch neither download
the dataset nor require a local bundle/cache. The browser requests `latest.json`
when opened, then the verified index and needed chunks directly from the shared
host. The build artifact has no historical catalogue or copy of the shared data.

Discovery requires HTTPS; localhost HTTP is allowed for development/tests.
Credentials, fragments and discovery redirects are rejected. Each new session
revalidates the descriptor, bounded to 4 KiB, and validates index/chunk lengths,
hashes, fields and date coverage. Missing/corrupt data uses the existing reload
error message. Optional `startJed` and `speed` retain their existing meaning.
`latest` cannot be combined with a bundle, archive, pin or retained set.

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

Development and watch keep one configuration for the process lifetime;
restart after changing its URL or local pin. Shared dataset updates need only a
browser reload. Source edits recompile normally. App assets can live in webpack's
memory filesystem; complete local bundles are staged and verified in `dist/data/`
once per process. Recompilations repeat staging only when output cleaning is
enabled; restart the process after externally deleting/replacing `dist`, or to
explicitly recheck or repair data. Shared
runtime selection stages no data. Configured
serve/watch reject output/static-root overrides, so the cleaner cannot reach an
input bundle and the data cannot become disconnected from its serving path.

## Immutable acquisition

A complete-bundle configuration accepts one `bundle` directory or `archive` object.
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

All standard production builds compile into a private sibling directory, then
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
copying arbitrary old cache directories.

For rollback between indexed pins, change the selected pin and keep both the
previous and newer pins in the deployment's retained set as needed. An empty
`retained` array keeps no additional indexed versions. Git history preserves
selection records; their referenced bundles must also remain available.
Expiring Actions artifacts alone are insufficient for rollback.

Prepared sites are limited to 900 MB of regular-file content, leaving headroom
under Pages' current 1 GB site limit. The known bundle is 398,669,815 bytes; two
such bundles plus the app fit, while three do not. This is a
bounded retention design: clients referencing omitted older versions may fail and
need reload. Multiple-version retention is optional under the current latest-data direction.
Do not describe two bundles as unlimited stale-client compatibility. The smaller
browser distribution still needs an explicitly tested implementation.
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Remaining delivery work

1. Finish and publish the producer's verified browser distribution, content-aware manual
   update path and shared static hosting in `orrery-data`. Consumer apps should
   fetch the shared dataset directly; no release archive or per-app data copy
   is required by the user's preference.
2. Reconcile this app's fixtures with the reviewed producer contract and replace
   the temporary local source with its real hosted endpoint. Verify clean builds
   without the local data cache, failed-update
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

`npm test` covers shared discovery/update/reload/cancellation, builds without
local data, archive transport, corruption/cache repair, failed builds,
retention and rollback through HTTP requests, actual normal build/dev/watch
commands, and the configured browser entry under a nested path. The existing
three-browser loader/graphics/lifecycle suite remains in place. These checks use
fixtures; full-data and hosted evidence must be reported separately.
