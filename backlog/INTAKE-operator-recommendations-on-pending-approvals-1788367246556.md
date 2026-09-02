# Intake: Operator recommendations on the nine pending approvals (NOT approvals)

Filed by the Operator (2026-09-02, human-directed via Claude Code). These are
RECOMMENDATIONS the human asked to have passed to the swarm. None of them is
a tap: `human_approval` on every ticket below stays exactly as it is until
the human answers on Approvals. Specifier/coordinator: use these to pre-stage
evidence, sharpen approval_context where it helps, and to know which option
the coder should be ready for - do not promote on the strength of this file.

| ticket | recommend | why, in one line |
|---|---|---|
| BL-1332 (critical) | option 1 - refuse the land when a shared path mixes the landing ticket with an unlanded sibling, naming both | Today's index.js:919 leak (BL-1314's replay carrying BL-1324's require) IS this defect; option 1 is small, gate-able, and cannot ship a wrong tree. Option 2 (per-hunk replay) is the better end state - mint it as the follow-up, not the fix. Agrees with the specifier's own recommendation. |
| BL-1340 (high) | A - recognise a required_wiring entry naming a specs/pipeline/steps registration as the pin | The pin must be load-bearing; A is independently enforced by the pre-QA gate, B is a bare declaration nothing checks, C strands 12 tickets behind BL-233. |
| BL-1339 (medium) | option 2 - writer plus the land-approval store read resolved from the shared root | Fixes "the predicate answers differently depending on who asks" for the store BL-1334 introduced, without editing the bounce-store read BL-952 protects (option 3). Option 1 alone leaves the commit-time guard blind. |
| BL-1335 | option 1 - promote automatically only when the classification is unambiguous, otherwise announce for operator confirmation | Opening a record restaffs a seat; the classifier reads pane text. Unambiguous-only keeps autonomy where it is safe and the operator in the loop where it is not; option 3 automates nothing. |
| BL-1336 | option 1 - fixed router ceiling above the current default, memory budget still the binding cap | Captures the speedup now with a pure, deterministic ceiling function; host-derived (option 2) turns a unit test flaky; option 3 exports a signal nobody uses yet. |
| BL-1323 (stamp-off 9c94735f03) | option 2 - certify as landed; mint a follow-up to recompute or clearly label the hint as trip-time-only | The snapshot-not-live hint will send an operator after a path they already cleared; a label is cheap and removes the confusion. (Note: hotfix f57795b6d2 narrowed that payload to still-blocking paths - it is still a trip-time snapshot.) |
| BL-472 (chore) | option 1 - provision a JVM and Clojure CLI on swarm hosts, then pin/install/wire - OR retire (option 2) if that infra is not wanted | Advise AGAINST option 3: a gate that "runs only where a JVM exists" silently does not run on this host and reads as a false green - the exact failure class this repo's own notes warn about. |
| BL-1333 (stamp-off f57795b6d2 + d5739d84cc) | approve the review parcel | No choice posed. Disclosure: the Operator authored that hotfix - the review is the independent check, and certify/waive stays with the human after it. |
| BL-1331 (low) | approve | No choice posed; mechanical require-cycle removal, BL-726's unmodified feature is the regression guard. |

By operator.
