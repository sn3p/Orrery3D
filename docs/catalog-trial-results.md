# Catalog adapter trial results

> **Historical trial-era documentation.** The later standalone rollout replaced
> the 100,000-object default described below with the larger indexed catalogue.
> The current production entry retains the final renderer paused behind a move
> dialog; the maintained catalogue consumer now lives in
> [Orrery](https://github.com/sn3p/Orrery).

The local indexed consumer trial supports **895,910 dated objects** and meets
the provisional desktop budgets at the agreed February 1980 start. The whole-file
control fails the startup and loading-task budgets. This supports continuing with
indexed delivery; it does **not** establish readiness for a public Pages switch.
The historical 100,000-object catalog remains the normal build's default.

## Review follow-up measurements — September 14, 2026

After the [implementation review fixes](catalog-trial-review-response.md), the
same full-data benchmark was repeated once for normal playback, maximum speed
and a final-date start. The original measurements below remain historical evidence.

| Follow-up case | Result |
|---|---|
| Normal playback, 10 Mbps / 100 ms | First complete GPU scene **1.31 s**; retained CPU **62.54 MB**; sampled peak **106.90 MB** |
| Catalog work | Longest operation **30.7 ms**; no catalog-associated task over 50 ms observed |
| Origin bodies at 30 / 60 / 120 seconds | **1.91 / 2.21 / 25.09 MB**; **34.92 MB** after the separate final-date jump |
| Buffering in the normal 120-second run | **0.40 s**; subsequent final-date jump **9.58 s** |
| Maximum speed over 60 seconds | First scene **1.27 s**; **18.30 s** buffering; complete population reached |
| Starting at the final date | First complete scene **34.68 s** |

All three runs reported no browser errors or catalog-associated long task over
50 ms. A page-wide 62 ms startup task in the normal run did not overlap a measured
catalog operation. These are single follow-up runs, not additional three-run
certification of every scenario. The late-start and fast-playback limitations
remain. Hardware, browser, pin and measurement limitations are unchanged.

Raw reports: `.context/catalog-trial/review-playback.json`, `review-fast.json`,
and `review-late.json`. The normal-playback measurement bundle SHA-256 is
`57df33575c0ff58512aff8ce802bfac795d8ab841b39ee7cdfcaa81cd31bc1d7`.
Source is PR30's initial commit `989e00f` plus the review follow-up diff.
The follow-up also passed all **10 Node tests** and the complete
**Chromium/Firefox/WebKit** suite, including the new recovery regressions and
the shader-test context reuse assertion.

## Initial trial measurements — September 14, 2026

Cold Chrome 151.0.7922.170, Apple M3 Max (14 logical CPUs, 36 GiB RAM),
1280×800, DPR 1, HTTP gzip, 10 Mbps / 100 ms emulated networking. Both modes use
the same producer pin. Initial date: JD 2444270.5; playback speed: 1.5
(90 simulated days/second). MB below means decimal megabytes.

| Measurement | Indexed | Whole file | Provisional budget |
|---|---:|---:|---:|
| First complete GPU scene | 1.27–1.30 s, three runs | 29.98 s | ≤2 s |
| Longest measured catalog operation | 32.7 ms | 1,621.6 ms | See task budget |
| Catalog-associated tasks over 50 ms | None observed | 1,621 ms maximum | None |
| Retained JS heap + backing storage, full population | 62.08–62.49 MB | 61.88 MB | ≤150 MB |
| Sampled peak CPU memory | 119.43–120.83 MB | 509.91 MB | Recorded separately |
| Nominal asteroid GPU attributes | 35.84 MB | 35.84 MB | Recorded separately |

One indexed run includes 120 seconds of playback; the other two repeat cold
startup followed by an explicit final-date jump. All three use the same app
bundle hash. Page-wide startup tasks still reached 51–56 ms; none overlapped
the measured catalog operations. These are observations on this computer,
not a guarantee for every device.

Encoded response bodies written by the local origin in the 120-second indexed
run, including the app, index, speculative requests and cancelled transfers:

| Milestone from navigation | Indexed origin bodies |
|---|---:|
| 30 seconds | 1.91 MB |
| 60 seconds | 2.21 MB |
| 120 seconds | 25.29 MB |
| Full population after a separate final-date jump | 35.12 MB |

The whole-file control wrote 34.56 MB before its first complete scene. Indexed
delivery reduces early transfer; visiting the entire population still transfers
about the same total data, with some overhead from lookahead/cancellation.
The original catalog alone is 118.82 MB JSON / 34.20 MB gzip; all chunk gzip
files total 34.26 MB. Chunking does not eliminate the catalog's total size.

The 120-second indexed run buffered for approximately **0.40 seconds** after
initial loading. Its final-date jump then took **9.88 seconds** to acquire the
remaining prefix. Once populated, both modes produced about 120 animation-frame
callbacks/second during a separate three-second render window.

## Limits exposed by the trial

- **Maximum playback speed (8, or 480 days/second):** first scene 1.28 seconds,
  about 20.16 seconds of buffering during a 60-second run, and the full population
  reached by the end. The loader preserves completeness and speed settings, but
  it cannot promise uninterrupted playback at this speed/network combination.
- **Starting at the final discovery date:** indexed startup took 35.15 seconds
  because the complete retained prefix was required. It does not meet the
  two-second budget at that start. Supporting fast arbitrary late starts would
  require a different loading/rendering design or a revised expectation.
- **Main-thread work:** an earlier repeat exposed a 58 ms task combining parsing
  and preparation. The final source yields between those phases while retaining
  its processing slot. Three final primary runs and the fast/late cases showed no
  catalog-associated long task. A worker was therefore deferred for this desktop
  trial; slower-device measurements may justify it.
- **Memory ownership:** a legacy JavaScript regular-expression result retained
  the large parsed input during exploration. Clearing it on parser success and
  failure removed that retention; regression coverage protects this behavior.
  Indexed mode still preallocates 57.34 MB of CPU catalog arrays and Three.js
  initially uploads the full 35.84 MB attribute capacity.

Earlier native-network measurements, before the final scheduling change, showed
indexed startup at 0.19 seconds and whole-file startup at 2.34 seconds. They are
historical comparison evidence, not final-source certification. One earlier
maximum-speed run timed out across a long wall-clock interruption; it was not
counted as a result and was rerun successfully.

## Verification and cleanup

- Producer tool 0.4.0 verified the complete pinned bundle. All 25 shared fixture
  files match the producer snapshot unchanged.
- Eight Node contract/provisioning tests pass, covering shared vectors, strict
  metadata, corrupt/truncated transport, ordered overlapping reads, independent
  cancellation, parser lifetime and clean-output protection.
- The complete Chromium, Firefox and WebKit regression suite passed. After the
  final scheduling change, the focused catalog workflows passed in all three
  again: actual configured boot/reload, discovery ties, reverse/jumps, clock
  recovery, retries/errors, source replacement, disposal, graphics restoration,
  allocation/shader failures, pause/hidden behavior and desktop/narrow controls.
- An independent integration review was completed. Every confirmed finding was
  fixed and covered by a regression check. Rendered loading/error states were
  inspected; existing orbit precision and native-app regressions passed.
- Local assembly verifies original data after webpack cleaning and stages it
  under an immutable hash path. Generated `dist/` is removed from Git tracking
  and ignored. There were no old download/import scripts in this repository to
  delete. Source build, development, benchmark and Pages scripts remain in use.
- Final normal-entry trial previews passed at both `/` and `/Orrery3D/`, including
  gzip responses, playback controls and desktop/narrow rendering with no browser
  errors. The normal clean build also booted successfully and emitted only the
  byte-identical historical 100,000-row catalog in `dist/data/`.

## Reproduction and evidence

See [trial instructions](catalog-trial.md). Producer source:
[`f6f4a1d`](https://github.com/sn3p/orrery-data/tree/f6f4a1d4e807362417c74ecbd2b74ce73306d41d),
contract v1, index SHA-256
`bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2`.
Consumer base: `91e81c59f2339adaf0feb1f39e32471eba6e4a39`, plus this working diff.

Final raw reports live in the gitignored `.context/catalog-trial/` directory:
`final-playback.json`, `final-repeats.json`, `final-fast.json`, and
`final-late.json`. They include configuration, hardware, browser, built app hash,
memory samples, transfer events, task timings and measurement limitations.
The primary indexed measurement bundle SHA-256 is
`0bb8096faf7ab4d13ede82981b6f53c5a6aa37ee2d6f0c5765d43bbd222fc8b2`.
The harness uses an inspection wrapper around the real boot and renderer.

Initial timing waits for a WebGL fence, not compositor presentation. The reported
frame rate counts animation callbacks, not presented frames. Retained memory is
measured after forced collection; roughly 250 ms peak samples can miss transient
allocations and exclude native/GPU memory. Origin byte counts exclude headers
and may precede emulated browser delivery; CDP bytes are also retained but can
undercount cancelled gzip transfers. Buffering is sampled at approximately 100 ms.

**Remaining before public rollout:** immutable public distribution, actual Pages
retrieval/assembly and HTTP compression/failure checks, prior-version retention
and rollback, representative slower/mobile devices, and the decision about
acceptable fast-playback/late-start behavior. No public data release, production
default change or deployment is part of this trial.
