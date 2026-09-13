# Unowned-red note — transient property-suite flakes, 2026-09-13

While verifying BL-1485 (which touches only `specs/pipeline/steps/*.js` and
one doc file — no `extension/src` or `extension/test` file), QA ran
`npm run test:properties` (from `extension/`) three times in a row to
establish a reliable baseline. Results:

| Run | Failing files |
|---|---|
| 1 | `bl1313BatchGuardVisibilityInvariants.property.test.js`, `bl1089FrontDeskLivenessFixture.property.test.js`, `bl956PipelineBoardCaptionCapInvariants.property.test.js` |
| 2 | `bl1313BatchGuardVisibilityInvariants.property.test.js`, `bl1089FrontDeskLivenessFixture.property.test.js`, `bl1272LandedSiblingInvariants.property.test.js`, `bl1253TokenOwnershipInvariants.property.test.js` |
| 3 | `bl1313BatchGuardVisibilityInvariants.property.test.js`, `bl1089FrontDeskLivenessFixture.property.test.js` |

`bl1313...` and `bl1089...` are already owned (register: BL-1503 and BL-1502
respectively) — reproduced in all 3 runs, consistent with a genuine standing
red.

`bl956PipelineBoardCaptionCapInvariants.property.test.js`,
`bl1272LandedSiblingInvariants.property.test.js`, and
`bl1253TokenOwnershipInvariants.property.test.js` each failed in exactly ONE
of the three full runs, and each passed cleanly when re-run in isolation
(and in a small 3-file batch) immediately after its failing full run. No
active/paused/hold ticket names any of the three
(`grep -rl <basename> backlog/active backlog/paused backlog/hold` empty for
each); `standing_red_register_cli.bb` shows no row for any of the three.

Classed **flaky**, not a deterministic standing red, from this evidence:
each is reproducible 0/2 times outside the full concurrent run that first
showed it red. `bl1272`'s failure was a 20000ms test timeout accompanied by
a `fatal: ambiguous argument 'origin/main'` git error in its own fixture,
consistent with resource contention under the full suite's own concurrency
rather than a logic defect. `bl1253`'s single failure
(`seed: -1747880424`, counterexample `["fresh","fresh","fresh","fresh","fresh","fresh"]`)
did not reproduce on a fresh seed in the immediate re-run.

Not filed as a mint request — flagging for the specifier to decide whether
any of the three warrants a ticket (a rare, load-sensitive flake is still a
flake worth a register row per Article 3.2's "a test failing on main is
type: defect" posture, but repeat reproduction attempts here could not
pin one down to a specific defect to describe). No action taken against
BL-1485 on account of this: it touches none of these three files, and its
own required checks (unit suite, its own acceptance features, the BL-1318
acceptance feature under all four env shapes) are green.

By QA.
