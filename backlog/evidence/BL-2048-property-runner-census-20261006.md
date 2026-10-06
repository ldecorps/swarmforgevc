# BL-2048 / BL-2049 - property-runner census, 2026-10-06

Status: IN PROGRESS. The first full run of every property runner under
`swarmforge/scripts/test` started 2026-10-06 18:52:33Z on main at
`435b2de1a9` (load average 14.7, swarm live). This file is committed with
the mint (QA note 003876) and completed in a follow-up commit when the run
ends. Every red it finds is an unowned red, handled the same pass.

## Method

One runner at a time, name order, from the master checkout:
`env -u TMUX timeout 600 <bb|bash|node> <runner> </dev/null`, recording
exit status and wall milliseconds per runner. Before running, the ten
runners that mention tmux were read: each uses a fake `tmux` on PATH or a
private `-S` socket, never the live server.

Population: `ls swarmforge/scripts/test | grep -E '_property_runner\.(bb|sh|js)$'`
= 217 (211 `.bb`, 4 `.sh`, 2 `.js`), equal to `git ls-files` of the same
glob. An extension vitest test names 15 of the `.bb` runners; none is in
suite-manifest.tsv (its `test-file?` shapes are `test_*.sh` and
`*_test_runner.bb`).

## Partial result at mint
```
runners 88 red 0 summed 1216s (20.3 min)
slowest:
  bl1086_cache_and_batch_property_runner.bb 284.5s
  bl1033_temp_root_cleanup_property_runner.bb 132.6s
  bl1405_hand_built_land_records_approval_property_runner.bb 122.5s
  bl1414_freshness_announce_digest_property_runner.sh 117.5s
  bl1411_a_forward_built_on_an_amended_contract_is_refused_property_runner.bb 71.6s
  bl1052_local_model_seat_property_runner.bb 65.4s
  bl1431_one_land_plan_one_tip_property_runner.bb 61.1s
  bl1407_property_gate_rerun_isolation_property_runner.bb 60.1s
  bl1028_promotion_refusal_property_runner.bb 44.1s
  bl1360_ceremony_handoff_property_runner.bb 43.9s
```

## Reach rule measured with a scratch prototype (never committed)

Rule (BL-2049): a runner is reached by a changed path under
`swarmforge/scripts/` when it is that path, when that `.bb` is in its
load-file closure (direct deps resolved against the runner's own
directory, then `bb-load-closure-lib/compute-closure` over
`swarmforge/scripts`), or when the runner's own text names the path's file
name. 28 of the 211 `.bb` runners load-file nothing.

Reach sets of the last 10 closed tickets that changed `swarmforge/scripts`
code: BL-1959 11, BL-1962 3, BL-1963 4, BL-1986 5, BL-1991 11, BL-1992 0,
BL-1997 4, BL-2037 0, BL-2038 5, BL-2039 23. `handoff_lib.bb` alone: 62.
A looser rule (the changed file name anywhere in the closure's text)
reached 68 to 89 for most of the same tickets, through comments in widely
loaded libs, so BL-2049 rules it out.

Times per reach set follow when the census completes.

By specifier.
