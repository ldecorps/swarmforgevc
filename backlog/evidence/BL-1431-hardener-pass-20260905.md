# BL-1431 — hardener pass, 2026-09-05

Ticket: BL-1431-one-land-plan-reads-one-tip
Commit reviewed: a6003f235f (cleaner) / 7a9cc3fab9 (architect, NONE pass)

## Result: NONE — no defect found

This is a live race-condition fix in the land-step CLI (`land_step_cli.bb`
/ `land_step_lib.bb`), already reviewed with unusual depth by all three
prior roles, including a DETERMINISTIC reproduction of the real 2026-09-05
race against real git fixtures. Re-verified fully rather than sampling,
given the severity class.

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/bl1431_one_land_plan_one_tip_property_runner.bb` | ALL PROPERTIES HOLD, 40/40 each of P1/P2, coverage `{:p1-no-siblings 14, :p1-some-siblings 26, :p1-multi-own 22, :p1-explicit-origin-main 23, :p1-resolves-itself 17, :p2-fails-first 23, :p2-fails-later 17}` |
| `node specs/pipeline/cli.js specs/features/BL-1431-...feature` | 4/4 scenario runs |
| BL-1389 / BL-1375 / BL-1354 / BL-1343 / BL-1315 (all 5 named sibling land-step regressions) | 5/5, 7/7, 5/5, 6/6, 7/7 — matches the coder's own reported counts exactly, unaffected |
| `bash test_land_step_records_approval.sh` (regression) | ALL CHECKS PASSED |
| `bash land_main_publish_test_runner.sh` (regression, untouched file) | ALL PASS |
| `bash test_is_qa_ancestor_land_replay_store.sh` (regression) | ALL CHECKS PASSED |
| `bash test_bl1366_land_is_one_command.sh` (regression) | ALL PASS |
| `grep -c origin-main-sha land_step_cli.bb` | 1 (required_wiring) |
| `bl1431OneLandPlanOneTipSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## No BL-113 gherkin mutation (no Scenario Outline)

The feature is four plain `Scenario:` blocks, no `Scenario Outline:` /
`Examples:` — the wrapper would report `inapplicable` (BL-638). Per the
BL-638 fallback, the coder's own P1/P2 properties, both shown non-vacuous
by break-then-restore against real git fixtures, plus the deterministic
`moving-tip` acceptance mode (a REAL mint commit pushed to a REAL bare
origin and fetched mid-walk, both plans compared structurally identical),
already constitute the hand-authored mutation sweep this class of ticket
calls for.

## Independent structural trace of the threading chain

Rather than trust the three prior roles' enumeration, re-derived it myself:

```
$ grep -n "origin-main-sha\b" land_step_lib.bb
58:  (doc comment)
60:  (defn origin-main-sha [root] ...)
413: entangled-siblings's own 5-arg convenience arity
511: main-ticket-sources's 2-arg convenience arity
581: ticket-approval-state's 2-arg convenience arity
823: own-paths's 3-arg convenience arity
835: own-paths's 7-arg (opts) convenience arity
993: land-plan's own entry, guarded by (contains? opts :origin-main)
1256: replay!'s own entry, same guard
```

Read `land-plan`'s body (line 993 onward) directly: `origin-main` is bound
once, then threaded positionally into `entangled-siblings` (as the last
arg), into `own-paths` (as the last arg, alongside `:path-landed-fn`'s own
closure over the same value), into `ancestry-commits`, and into
`delivered-attribution` — every downstream computation in one `land-plan`
call reads the identical binding, with no second `origin-main-sha` call
anywhere in the walk. `own-paths`'s own default `approval-fn` (when the
caller supplies none) closes over the SAME already-resolved `origin-main`
rather than letting `ticket-approval-state`'s own convenience arity
re-resolve a second, potentially different, tip — exactly the coder's own
described fix for the second-order race (a sibling-approval lookup that
would otherwise silently re-read the ref a fourth time).

Confirmed no gap: every one of the 7 sites is a genuine entry point for a
caller with no already-resolved value, never a reader consuming a value
another function already threaded to it.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above.

## Verdict

No defect. Forwarding unchanged to documenter.
