# BL-1432 — hardener pass, 2026-09-05

Ticket: BL-1432-the-land-walk-ranges-over-the-parcel
Commit reviewed: 301efac0c9 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` | ALL PASS |
| `node specs/pipeline/cli.js specs/features/BL-1432-...feature` | 5/5 pass |
| `node specs/pipeline/cli.js specs/features/BL-668-...feature` (regression) | 5/5 pass |
| All 9 land-step sibling features (BL-1241/1315/1332/1339/1343/1354/1375/1389/1431) | 4/4, 7/7, 6/6, 7/7, 6/6, 5/5, 7/7, 5/5, 4/4 — 100% pass on every one |
| 3 pre-existing-failure features (BL-1374/1297/1272), run directly | 0/4, 5/1, 5/1 — exact match to the coder's and cleaner's own claimed baseline, confirming these are pre-existing unrelated failures |
| `npx jscpd` (new step handler vs its modeled sibling `bl1026StageBudgetStatedOnceSteps.js`) | 0 clones |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently read both fixed mechanisms directly

- `task_scope_gate_lib.bb:429-444` (`parcel-own-base`): reuses the
  existing `last-handoff-commit`/`effective-base` machinery, never a
  second implementation; `nil` on a first hop or unreadable base, both of
  which the caller (`land-plan`) falls back to `origin-main` for —
  confirmed by reading the call site directly.
- `land_step_lib.bb:1015-1028` (`land-plan`'s `walk-base` computation):
  `(or (task-scope-gate-lib/parcel-own-base ...) origin-main)` when the
  caller omits `:base` — confirmed `origin-main` is threaded unchanged
  everywhere a landed/unlanded verdict is read, while only the candidate
  range (`walk-base`) narrows. Matches invariant 2 by construction.
- `land_step_lib.bb:1363-1404` (`post-land-repoint!`): `in_process`
  checked BEFORE the generic dirty check (mirroring BL-1421's own
  ordering); `git reset --hard` gated behind BOTH clean checks; every
  outcome (repointed or skipped, naming why) logged. Matches invariant 3
  by construction.

## Independently confirmed the flagged live-wiring gap myself

`grep -rn post-land-repoint swarmforge/scripts/*.bb
specs/pipeline/steps/*.js` — only the function's own definition and the
acceptance step handler reference it; no production call site
(`land_step_cli.bb`, `post_qa_branch_sweep_lib.bb`, `handoffd.bb` all
confirmed silent on it). Agree with the cleaner's and architect's own
routing: this is a spec-authoring tension between the acceptance feature
(which correctly tests `post-land-repoint!` as a standalone mechanism,
matching what was built) and `qa_e2e_procedure` step 2 (a live check that
cannot be satisfied until something is wired to call it) — not a defect
in this parcel's own delivered work, and already correctly disclosed and
routed forward through the evidence chain rather than silently absorbed.

## Independently reproduced non-vacuity myself (not just trusted), both mechanisms

**Bounded walk**: hardcoded `walk-base` to always equal `origin-main`
(ignoring `:base`/`parcel-own-base`), re-ran the bb unit suite: **2
failures** — `land-plan :base - the SAME tip, bounded, sees nothing
before base` and `...names the sibling` — reproducing exactly the
pre-fix defect (a stale sibling misread as entangled, and double-counted
alongside the real new one). Restored; confirmed byte-identical via
`diff` and `git status --short` (empty); re-ran — ALL PASS again.

**Re-point refusal**: separately mutated `post-land-repoint!`'s `cond` to
wrap both refusal branches' conditions in `(and false ...)`, re-ran the
suite: **5 failures** (a dirty/in-process tree silently repointed,
wrong action, no reason named, wrong log line) — confirms both guard
conditions are genuinely load-bearing, not decorative. Restored;
confirmed byte-identical via `diff` and `git status --short` (empty);
re-ran — ALL PASS again.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 04, 2 examples, 1 mutable column = 2
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **2 mutants, 2 killed, 0
survived** — manifest confirms
`"Total":2,"Killed":2,"Survived":0,"Errors":0"`. Scenarios 01-03 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Babashka files carry no mutation/CRAP/DRY tooling (BL-472 deferred,
Engineering Rules) — gated by the unit-test pass/fail plus the clean
BL-113 gherkin-mutation pass above, matching every prior role's own
disposition. jscpd confirms zero duplication in the new step handler.

## Verdict

No defect. Forwarding to documenter, with the flagged live-wiring gap
(no production call site for `post-land-repoint!`) carried forward via
the cleaner's evidence file, already in the chain QA reads.
