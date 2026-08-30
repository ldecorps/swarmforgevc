# BL-1295 — QA confirms landed-as-passenger, park is stale

**Confirms:** `main:backlog/evidence/BL-1295-landed-park-is-stale-20260830.md`
(specifier, commit `045dcc11bd`), per coordinator note (priority `00`,
`00_20260830T200742Z_003275_from_coordinator_to_QA_for_QA.handoff`):
"BL-1295 landed as passenger in BL-1297 merge - confirm + send close note".

## What this is

BL-1295 was already QA-verified CLEAN (`68f40bfc5e`, `backlog/evidence/
BL-1295-land-escalate-20260830.md`) and only LAND_ESCALATEd for entanglement
with then-unlanded siblings BL-1253/BL-1272. It was parked at QA
(`status: blocked`, `724a953ea5`) intact on `swarmforge-QA`, never bounced.
BL-1297 (the entanglement's root cause) has since landed and closed
(`c49a53d9f6`), and that landing carried BL-1295's own QA merge (`0c550b4bcb`)
onto `main` as a passenger — no bounce, no rework, nothing to re-verify
behaviorally. This is a landing confirmation, not a fresh verification pass.

## Independently re-run, not taken on the specifier's word

`main` is the correct ref for this check: `git rev-list --left-right --count
main...origin/main` → `9  0` — local `main` (`a62fd47748`) is strictly ahead
of `origin/main` (`c49a53d9f6`), which contains zero commits main lacks.

| # | Check | Result |
|---|---|---|
| 1 | `git merge-base --is-ancestor 0c550b4bcb main` | YES — real ancestor |
| 2 | `revert-subject?` in `main:swarmforge/scripts/task_scope_gate_lib.bb` | present, line 275 |
| 3 | `bl1295RevertSubjectAttributionSteps` in `main:specs/pipeline/steps/index.js` | **registered**, line 655 (not BL-1253's failure mode) |
| 4 | `main:specs/features/BL-1295-...feature` vs parcel tip `0c550b4bcb` | byte-identical |
| 5 | `main:specs/pipeline/steps/bl1295RevertSubjectAttributionSteps.js` vs parcel tip | +8 lines only, additive (BL-1297 merge-base-visibility adjustment noted in-code) |
| 6 | `git log -S 'revert-subject?' --first-parent main` | introduced by `0c550b4bcb`, the genuine QA merge |

All six match the specifier's evidence exactly. No discrepancy found.

## Disposition

Confirmed landed. Nothing further owed by coder/cleaner/architect/hardener/
documenter — the work is on `main` and the earlier QA pass already covered
behavior, coverage, and wiring. This ticket needs no land-step re-run and no
`origin/main` push from QA (there is no new commit of QA's own to push; the
content already reached `origin/main` via BL-1297's landing push).

Coordinator bookkeeping only: move BL-1295 to `backlog/done/`, free the
active slot (cap `1`), and route the next promoted item — the pipeline has
been idle on this stale park since ~20:05Z.
