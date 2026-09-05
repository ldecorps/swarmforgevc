# BL-1368 — hardener pass, 2026-09-05

Merged architect commit `c6e2ce5db7` (COMPLIANT, clean sweep — both
invariants verified directly at all four human-decision call sites and
the three untouched pipeline-role sites, distinguishing this from the
false-attribution incident that cost three roles a turn each on
2026-09-03 —
`backlog/evidence/BL-1368-architect-20260905.md`). Real `extension/src`
production code across four files.

## Checks re-run, all independently

- `npm run compile` clean, then:
  `bl1368ApprovalCommitByline.test.js` — 7/7 pass.
  `telegramFrontDeskBotCore.test.js` — 449/449 pass (the three stderr
  lines during the run are expected fixture output for negative cases,
  confirmed by reading them — not failures).
  `commitIntegrityRunner.test.js` — 10/10 pass.
- `bl1368ApprovalCommitByline.property.test.js` — 3/3 pass, including the
  property asserting a pipeline role's own commit still passes the role
  byline check while a human-decision commit correctly does not.
- `run_acceptance.sh` on the BL-1368 feature — 4/4 pass.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly at all three sites:
  `bridgeServer.ts:953` and `telegramFrontDeskBotCore.ts:1323` both
  compose from `humanDecisionCommitMessage`; `registerSteps` exported
  from `bl1368ApprovalCommitNamesDeciderSteps.js:122/176`.
- `check-commit-byline` (`compliance_battery_lib.bb:118`) confirmed the
  only occurrence of that function anywhere in `swarmforge/scripts/` (its
  own definition plus its one caller in `compliance_battery.bb`), and 0
  hits in `run_commit_guards.sh`'s chain — confirms no commit guard goes
  red over a human-decision commit's byline.
- `jscpd` over the four changed TS files — 2 clones, at the exact line
  ranges (34-155, 1284-1405) the architect traced to code far from this
  ticket's single-line edit sites — confirmed pre-existing, unrelated
  debt, not introduced by this parcel.

## BL-113 Gherkin mutation

One `Scenario Outline` present. Ran the real mutation pass: `"outcome":
"pass"`. Confirmed against the embedded manifest per BL-460 discipline:
`{"Total":3,"Killed":3,"Survived":0,"Errors":0}`.

## Hand-mutation spot-check (mutation_cost: low)

Mutated `HUMAN_DECISION_BYLINE` from `'By the human, recorded by the
front desk.'` to `'By coder.'` (the exact literal this ticket exists to
remove) to confirm the constant is genuinely load-bearing, not dead
code. **First attempt SURVIVED — a real trap, not a real gap**: the unit
test loads from `../out/util/commitIntegrityRunner` (compiled output),
and I had mutated only `src/` without recompiling — the classic
"out/ is what tests exercise" pitfall this session's own engineering
notes warn about. Recompiled and re-ran: **7/7 tests FAIL**, confirming
the byline constant is genuinely the single source of truth every
call site and test depends on. Restored the source file byte-identical
(diffed against a pre-mutation backup) and recompiled again before
confirming the real suite passes clean.

## CRAP / DRY

CRAP not run: the ticket's changes are small, targeted composer-call
insertions (an import plus one function call per site) rather than new
control flow — no function's cyclomatic complexity changed. DRY (jscpd)
checked above — 2 pre-existing clones, unrelated to this parcel.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes (three unrelated bash pids
seen by `pgrep` are not test runners). Hand-mutation backup removed
after use. Clean working tree apart from the BL-113 manifest stamp.

## Result

Both declared invariants (human-decision commits name the decider, never
a pipeline role; pipeline-role commits stay untouched) re-verified
independently across 469 unit assertions, 3 property runs, 4 acceptance
scenarios, and a real BL-113 mutation pass, plus a hand-mutation
spot-check that caught my own compile-forgetting mistake before it could
produce a false "equivalent" verdict. Forwarding to documenter.

By hardener.
