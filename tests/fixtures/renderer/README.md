# Renderer catalogue fixture

This is the former 100,000-object app catalogue, retained unchanged for numerical,
GPU, memory and benchmark regression coverage. It is not an application data
source or a selectable catalogue mode. Production boot is tested separately with
configured indexed, whole and shared browser sources.

- Rows: 100,000
- SHA-256: `46da56fa836c356d9fd8ed0dd9b113702375646758881573ec6ef7acb2732c99`
- Previous location: `data/catalog.json` before the historical-mode removal in PR31.

Its original contents and Git history are preserved. It predates the producer's
indexed contract; do not assign it producer provenance or treat it as current MPC
data. The test and benchmark entries explicitly load it; app builds cannot.
