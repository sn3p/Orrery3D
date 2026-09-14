# Shared browser catalogue fixtures

These small tied-date and empty datasets match the merged `orrery-data`
[browser-distribution contract](https://github.com/sn3p/orrery-data/tree/c01d694d71c1734aa9d600afd7f0c58d81654b66/tests/fixtures/browser-v1)
from [PR5](https://github.com/sn3p/orrery-data/pull/5), verified 14 September 2026.
They preserve the source rows from `../consumer-v1/` and exercise the separately
versioned browser contract: `latest.json`, hashed index/chunk paths, and header
and notice provenance without whole-file or gzip descriptors.

All 11 data and provenance files were compared byte-for-byte with that producer
commit before enabling its published Pages endpoint. The existing complete-bundle
v1 fixtures remain independent.
