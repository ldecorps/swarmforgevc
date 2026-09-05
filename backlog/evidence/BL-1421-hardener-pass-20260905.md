# BL-1421 — hardener pass, 2026-09-05

Ticket: BL-1421-one-standing-surfacing-per-role
Commit reviewed: 48931c7d10 (cleaner) / 2365bc2269 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (3/3 killed)

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/post_qa_branch_sweep_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/bl1421_one_standing_surfacing_property_runner.bb` | ALL PROPERTIES HOLD, 500/500 each of P1/P1b/P2/P3, coverage `{:p1-len-over-5 339, :p1-has-a-recatch-tell 454, :p2-dirty-true 263, :p3-some-throwing 455}` |
| `node specs/pipeline/cli.js specs/features/BL-1421-...feature` | 6/6 scenario runs |
| `node specs/pipeline/cli.js specs/features/BL-1361-...feature` (regression, feature unedited per ticket) | 6/6, unaffected |
| `node specs/pipeline/cli.js specs/features/BL-668-...feature` (regression) | 5/5, unaffected |
| `grep -n caught-up-to-told? swarmforge/scripts/handoffd.bb` | matches (required_wiring #1) |
| `bl1421OneStandingSurfacingSteps.js::registerSteps` present | yes (required_wiring #2) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 3 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1421-one-standing-surfacing-per-role.feature <fresh
mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4 positionals
explicit, workdir removed after). Result: **3 mutants, 3 killed, 0
survived** (the `<reason>` example cells, single-letter case flips) —
clean. Manifest stamp committed alongside this evidence.

## Manual trace beyond what architect/cleaner already covered

Traced several edge cases not explicitly called out in the prior evidence
files, to look for a boundary gap in the same class BL-1407's own hardening
pass found (a shared-state edge undertested by both the property generator
and the fixed-scenario suite):

- **Different reasons for the same role are independent standing
  surfacings.** `told-sha-for`/`record-surface!` key on `(role, reason)`,
  so a role told for `:dirty-worktree` and later (a different tick, its
  decision having changed) surfaced for `:in-process-work` gets two
  independent records; the first can go stale (uncaught-up, unconsulted)
  without causing a re-tell, since `decide-role` only ever returns ONE
  reason per tick and only that reason's record is touched. Confirmed by
  reading `decide-role`'s single-branch `cond` and `sweep-one-role`'s
  routing — not a bug, just accumulated inert state, harmless.
- **`caught-up-to-told?`'s failure-to-determine cases default toward
  "not caught up"** (missing role-info, missing HEAD, told-sha unreachable
  in the worktree's object database) — same fail-toward-suppression
  direction `:can-ff?` already uses via the identical `git-is-ancestor?`
  primitive (a non-zero `git merge-base --is-ancestor` exit, whether a
  genuine "no" or an error, reads as `false`). This is pre-existing
  convention this ticket correctly reuses, not new risk it introduces.
- **`wake-for-reason?` is untouched by this ticket** (confirmed via diff:
  only `decide-role`'s clause order and the surfacing-state machinery
  changed) — the wake/tell split BL-1361 established still routes only
  `:dirty-worktree` to a wake, `:in-process-work`/`:divergent-branch` to a
  tell-only deferred note, exactly per the human's standing ruling.

No gap found in any of these. Given the coder's own audit already found
and fixed one real pre-existing bug (the settle-fails-to-`:divergent-branch`
path bypassing `surface-already-recorded?`) and unified both call sites
through `surface-or-suppress`, and given P1/P1b/P2/P3's reachability floors
are all well above the 50-run threshold with a live break-then-restore
record for each, I judge this parcel thoroughly covered.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
