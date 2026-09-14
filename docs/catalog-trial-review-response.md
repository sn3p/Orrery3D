# Consumer trial implementation review response

The supplied September 14 review identified valid recovery and integration
issues in draft PR30. This follow-up keeps the existing data contract and trial
scope, and addresses those issues at their actual loading/rendering boundaries.

| Finding | Disposition |
|---|---|
| Opening failure freezes the scene | Fixed. Waiting is derived from opening/coverage state. A failed open preserves its alert while planets and readouts advance; the old asteroid population remains hidden. |
| Shader failure blocks public-app redraws | Fixed. Unaffected scene rendering continues through animation and resize. Trial graphics completeness still remains false after a shader error. |
| Preparation exceptions retried as downloads | Fixed. Commit/preparation failures are terminal renderer errors with distinct copy and no fetch retry. Producer-valid values outside Float32 limits have browser regressions. |
| Exhausted speculative reads poison future demand | Fixed. A failed lookahead read leaves a complete current scene usable. Newly required missing records, playback/visibility resumption, or an online signal can start a fresh bounded attempt. Repeated frames and advances within already retained data do not reset its budget. |
| Shrinking lookahead discards required work | Fixed. An existing read continues while it serves missing required records; it is cancelled once its remaining range is unnecessary. |
| Fallback rendering overwrites pending demand | Fixed. Rendering the previous complete date preserves the requested date and its read. |
| Manual date setter/renderFrame mismatch | Fixed. `renderFrame()` consumes a pending date once its entire population is available. Repeated assignment is a no-op. A date assigned during index loading also survives activation. |
| Corrupt/incomplete generated cache blocks all builds | Fixed. A verified replacement is staged before the damaged generated cache is replaced. Invalid source input still fails without destroying a usable cache. |
| Timer task boundaries throttle hidden loading | Changed to posted-message task boundaries in browsers, with port cleanup; Node retains a timer fallback. Suspended/frozen browser pages are still subject to browser lifecycle policy. |
| Empty-prefix phase update requests a whole-buffer upload | Fixed. No attribute update is marked when there are zero committed records. |
| `AbortSignal.any` compatibility | Removed the dependency. Each read links its own cancellation signals and removes listeners at completion/cancellation. This is not certification of otherwise untested old browsers. |
| Mirrored loading state and repeated status/demand logic | Simplified to a waiting getter and shared status/demand helpers. |
| Repeated bundle verification | Removed one redundant full pass by carrying the verified inventory internally. Producer input, staged cache and final copied output still receive verification. |
| Unrelated webpack definitions are discarded | Fixed narrowly: replace the trial definition while preserving other keys and DefinePlugin instances. A real fixture build verifies emitted values. |
| Frustum culling can falsely count as graphics commitment | Fixed despite being unranked in the review. The asteroid object's render callback supplies the receipt; a culled cloud cannot mark its arrays committed. An empty catalog needs no asteroid draw. |

The existing retained-buffer preparation step remains. It adds renderer-specific
Float32 checks beyond the producer contract and prepares a complete batch before
mutating the cloud. Writing directly into live arrays would need its own failure
and ownership design. Current measurements do not justify that additional scope.

The source-wide `FileSlots` limit also remains: two independently overlapping
reads each have a pending queue, so those queues alone cannot bound their combined
work. Shared browser/Node tests exercise that overlap and cancellation boundary.

General binary-search, server and compiler-wrapper consolidation, a webpack
config-factory migration, and module-type cleanup are deferred. The module-type
warning is harmless; changing the project's CommonJS/ESM configuration solely
to suppress it is unnecessary for these fixes.

## WebKit CI failure

The initial PR check failed the strict console-error assertion after warning
about too many active WebGL contexts. Shader validation created 14 separate
contexts; later renderer tests added more. Context loss alone does not guarantee
immediate reclamation of native contexts.

Shader validation now reuses one context and releases each case's resources.
The suite asserts that only one validation context was created, while retaining
all 12 catalog-date comparisons, color boundaries, eccentric-orbit checks and
rendered comparisons. The console-error assertion remains unchanged.

## Verification boundaries

The new browser regressions exercise real fetches, source activation, manual and
scheduled rendering, preparation, GPU receipt, failure status, online recovery,
pause and resize. The original supplied review did not run browser tests; this
follow-up includes the focused catalog workflows and the full existing suite.
An independent pass checked the fixes and caught additional retry/date/test
edges, which were corrected and covered.

The earlier results in [the measurement report](catalog-trial-results.md) retain
their recorded revision and conditions. Any follow-up measurements are identified
separately there. Actual Pages delivery, slower/mobile devices, new controls and
public rollout remain outside this PR's local trial scope.
