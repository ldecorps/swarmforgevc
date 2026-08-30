# BL-1307 — QA hold: land_step_lib.bb missed an entangled sibling (BL-1300)

**Verdict: work verified CORRECT and fully green. NOT landed.** This is not
a bounce — no defect found in coder/architect/hardener/documenter's own
BL-1307 work. The defect is in the shared land-step tooling itself,
discovered while executing the BL-1241 land remedy on this ticket's cited
commit.

## Independent verification of BL-1307's own work (all green)

- Merged documenter `bd27e884cb` into `swarmforge-QA`; ancestry confirmed:
  coder `6f8227894e`, architect `a7d02db4e0`, hardener `7016ab9849` are all
  ancestors of `bd27e884cb` (BL-336 discipline).
- `bb swarmforge/scripts/test/review_forward_evidence_gate_lib_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/review_forward_evidence_gate_lib_property_runner.bb` — ALL PASS
- `run_acceptance.sh specs/features/BL-1307-...feature` — 6/6
- Sibling acceptance regressions unmoved: BL-1293 6/6, BL-806 9/9, BL-950 6/6
- Send-path regression: `test_swarm_handoff_sync_deliver.sh`,
  `test_swarm_handoff_daemon_backup.sh`, `handoff_lib_test_runner.bb` — ALL PASS
- `required_wiring` anchor confirmed live: `swarm_handoff.bb:381-395` calls
  `forward-carries-own-evidence?`.
- Step registration confirmed: `specs/pipeline/steps/index.js:551`.
- `npm run compile` (extension/): clean. No `extension/` path touched by
  this parcel (confirmed via `git diff --name-only 46c2d2a6b2 bd27e884cb`),
  so per the BL-1293/BL-1299 precedent the whole-suite `npm test`/`npm run
  test:properties` baseline already established during BL-1288's QA pass
  today (16 files/26 tests pre-existing failures, none touching a BL-1307
  path) is reused rather than re-run.
- No prior bounce history for BL-1307 on `main`/`origin/main` (both in
  sync, `git rev-list --left-right --count main...origin/main` → `0 0`).
- Orphan process check clean before/after (`pgrep -fl 'node --test|stryker'`).

## The land-step defect

Ran `bb swarmforge/scripts/land_step_cli.bb
BL-1307-a-review-forward-adds-evidence-the-role-authored bd27e884cb
/home/carillon/swarmforgevc` per the BL-1241 remedy (Article/QA.prompt).
Result:

```
LAND_REPLAY land-replay/BL-1307-bd27e884cb c251bb4b666debd20d084c8623890082ec76ea3f
ENTANGLED_SIBLING BL-1288
ENTANGLED_SIBLING BL-1293
ENTANGLED_SIBLING BL-1299
```

BL-1288/1293/1299 are all independently confirmed **already landed** on
`origin/main` (via their own tip-pure replays `16570bc52b`, `45945fc206`,
`dbcdd00722` respectively) — they show as "entangled" only because BL-1307's
own commits made further edits to the same shared `.bb` files, so a
byte-identical check against `origin/main` correctly fails on those paths.
This part is working as designed; not a defect.

**BL-1300 is the problem, and it is not even named.** `backlog/active/
BL-1300-the-headroom-proof-is-a-permanent-hidden-budget.yaml` currently
carries `human_approval: pending` — BL-1300 is verified green but
deliberately NOT landed, held for a human ruling
(`backlog/evidence/BL-1300-qa-hold-pending-human-ruling-20260830.md`). Its
own commits (`9553cf9354`, `3fe063d3ad`) sit in the coder branch's history
*before* BL-1307's coder work, but were never carried into the documenter
branch under their own tagged merge (BL-1300 never reached documenter — it
is still parked at QA). They are folded, untagged, into a single documenter
merge whose subject names BL-1307 instead:

    723a06fad3 Merge hardender 7016ab9849 (BL-1307) into documenter. By documenter.
      parent 1 (first):  6b753c1d62  (documenter's prior tip)
      parent 2:           7016ab9849  (hardener's BL-1307 forward, itself
                                        descended from the coder branch that
                                        carries BL-1300's unlanded commits)

`git rev-list --first-parent origin/main..bd27e884cb` never visits
`9553cf9354`/`3fe063d3ad` at all (confirmed: 0 hits) — they are reachable
only through `723a06fad3`'s *second* parent. `land_step_lib.bb`'s
`entangled-siblings` candidate walk (`ancestry-commits`, also
`--first-parent`) therefore never sees a commit whose subject names
BL-1300, so BL-1300 is never added to the `siblings` set — not entangled,
not landed, simply invisible.

Meanwhile `own-paths` (`task-tagged-changed-paths ... :delivered`) DOES
count `723a06fad3` as BL-1307-tagged (its subject names BL-1307), and
`:delivered` diffs a merge against its first parent only — which pulls in
*everything* parent 2 (the whole hardener/coder branch) added, including
BL-1300's untagged content. The replay `c251bb4b666d...` confirms this:
its diff includes, alongside BL-1307's real 13 files —

    backlog/evidence/BL-1300-coder-20260830.md
    extension/test/bl1300HeadroomProofIsPinned.test.js
    extension/test/bl1300SingleEnforceableBudget.property.test.js
    specs/pipeline/steps/bl1227BootPrefixLiveBudgetCheckSteps.js  (+107 lines)

None of these exist on `origin/main` (checked directly:
`git show origin/main:extension/test/bl1300HeadroomProofIsPinned.test.js`
→ does not exist). Landing `c251bb4b666d...` as cited would ship BL-1300's
code while its `human_approval` is still `pending` — exactly the gate this
ticket's `human_ruling` field exists to enforce, bypassed silently.

## Why this is not a bounce, and not a hand-rolled fix

`land_step_lib.bb`/`task_scope_gate_lib.bb` are shared swarm machinery, not
BL-1307's own deliverable — no role in this ticket's chain owns fixing them,
and QA.prompt's own guidance is explicit: "this remedy has a tool, do not
hand-roll the replay." Stripping the four BL-1300 paths out of the replay
tip by hand would be exactly that hand-roll, and would leave the underlying
detection gap live for the next ticket that hits this same shape (any
forward-merge whose subject tags the current ticket while its first-parent
diff spans back over an earlier, still-parked-at-QA ticket's untagged
commits).

## Disposition

**QA HOLD.** `bd27e884cb` merged into `swarmforge-QA` (verified, not
reverted — no defect in BL-1307's own work). Not landed. Not forwarded.
`land-replay/BL-1307-bd27e884cb` (commit `c251bb4b666d...`) left in place,
unlanded, as inspectable evidence — do not land it as cited.

Sent specifier a `note`, priority `00`, naming this evidence file and both
open blockers: (1) BL-1300's own pending human ruling, and (2)
`land_step_lib.bb`'s missed-sibling gap when an earlier ticket's commits are
folded untagged into a later ticket's forward-merge.

By QA.
