# Consumer contract v1 fixtures

These are small, valid producer bundles for independent Orrery/Orrery3D adapter
and loader tests. `cases.json` supplies their trusted index pins, numerical-date
queries and ordinal-range expectations. Resolve each pin's `url` against its
bundle directory URL, both at a host root and under an app subpath. Run the
whole-file and indexed adapter against the **same** bundle.

Generated through the real `refresh -> export -> export-indexed` CLI using tool
0.4.0, Python 3.12.7 / zlib recorded in the contained original export manifests.
The source is the small MPC excerpts one directory above, with deliberate test
changes: `ties` replaces the first three discovery dates by 2000-01-01; `empty`
replaces all discovery-number keys by unmatched numbers 900001–900006. These
are test populations, not scientific exports. Upstream source URLs/notices are
retained; acquisition is local with unknown original retrieval time. Full field
values other than those discovery matches remain unchanged.

`ties` has six dated and three undated rows. Its 300-byte chunks split the three
2000-01-01 discoveries across files; four rows belong in a complete scene at
JD 2451544.5. `empty` has nine undated rows and no browser records. Empty chunk
directories need not be retained in Git or a deployment archive.

Producer tests verify both bundles through `verify-indexed`, reconcile the
query vectors independently against actual rows, and test corrupt/truncated/
missing files and wrong hashes through the real CLI. Source commands need not
regenerate these fixtures on every test run: timestamps and exact pins are
retained evidence. Existing tools may verify fixtures produced by older tool
versions while contract/schema versions remain supported.

Consumer conformance additionally needs the following controlled failures:

- Apply each `invalid_requests` vector to the `ties` bundle; reject without a
  successful completion. Also reject nonfinite dates (NaN and ±Infinity), which
  cannot be represented in strict JSON.
- Change `contract_version` to 2 or `encoding` to an unsupported value in an
  index, update the test pin to its new bytes/hash, and verify opening rejects
  it. An unchanged pin should instead fail integrity first.
- Fail a chunk request (404), truncate its response, or change a byte. Never
  emit completion for the affected read. A retry may use already verified
  ranges but must fetch/verify missing work.
- Serve decoded JSON normally and with transparent HTTP gzip. Both must satisfy
  the outer file hash. If testing explicit `.gz` URLs, decompress exactly once
  and verify both stored and decoded identities.
- Request an interior range such as `[1,4)` that cuts through boundary files.
  Yield precisely those ordinals; file boundaries do not alter the API range.

`loader-cases.json` specifies required state scenarios, independent of any
particular app's event API. Translate the steps through the real consumer
loader, graphics preparation and playback clock; do not substitute a test-only
loader model. Both the metadata and graphics conditions must hold before the
scene is complete. Producer tests do not claim to verify these runtime behaviors.

No fixture authorizes consumer adoption or a production catalog switch.
