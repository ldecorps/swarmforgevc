# BL-973 — hardener pass

Received from architect as `merge_and_process architect 46f79f75f9` (compliant
verdict, no code change — see backlog/evidence/BL-973-architect-pass-20260823.md).

## Scope check — no Stryker/CRAP/DRY surface in this parcel

`git diff --name-only` against the parcel shows no `extension/src/*.ts` file
touched (the one `extension/` file is `extension/test/readLiveRoleHeldTicketsCli.test.js`,
a test). Stryker mutates `out/**/*.js` (compiled from `extension/src`) and both
`crap`/`dry` npm scripts scope to `extension/src` — none apply here. Every new
production module lives under `specs/pipeline/steps/lib/` or
`swarmforge/scripts/`, i.e. the Babashka/specs-pipeline surface with no
mutation/CRAP/DRY tool wired (engineering.prompt Startup Tools) — gated by its
own unit-test suite, which this parcel already carries at unusual depth (two
dedicated property runners plus a cross-language agreement runner, both
re-verified below).

## BL-113 Gherkin mutation — the one mutation-capable surface here

The feature carries two `Scenario Outline`s (02: per-row closure check, 03:
new-edge-fails-every-list), which is exactly the surface exercising
`bbFixtureClosureGate.js`'s `effectiveList`/`missingFromList` — the one new
pure JS module with no unit test of its own (only reached via the acceptance
step handler `bl973CopyListsClosureDerivedSteps.js`), so this is its real
mutation coverage.

```
specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-973-copy-lists-closure-derived-and-suite-completeness.feature \
  tmp/bl973-gherkin-mutation \
  specs/pipeline/steps/index.js \
  soft
```

All four positionals passed explicitly per the standing rule (a mis-ordered
call crash-fakes a clean sweep, BL-884). Took 28s real wall-clock — not a
suspiciously-instant crash-fake result.

Embedded manifest (durable verdict, not the stdout line, per BL-460/BL-502):

| scenario | mutation_count | Killed | Survived | Errors |
|---|---|---|---|---|
| 02 (per-row closure) | 10 | 10 | 0 | 0 |
| 03 (new-edge fails every list) | 5 | 5 | 0 | 0 |

15/15 killed, 0 survived, 0 errors. No equivalent-mutant call needed. Own
scratch work dir (`tmp/bl973-gherkin-mutation`) removed after the run; no
orphaned `gherkin-mutator`/`mutationWorker` process left (`pgrep` clean).

## Re-verified the coder/architect's own bb suite numbers myself

Ran directly rather than through `run_bb_suite.sh`'s full sweep — the
runner's own header warns some standing tests drive real tmux and must run
from a detached host shell, `env -u TMUX`, never an agent pane
([[darkcount-loop-wipes-tmux-sessions]]), and `$TMUX` is set in this session
(a live swarm pane). Confirmed by grep that none of the five targeted files
below touch a real tmux server (`test_lean_ledger_bb_wiring.sh` stubs a fake
`tmux` binary on a scratch `$PATH`; the two `bl973_*` files only reference
the string "drives real tmux" as fixture/reason text) — safe to run here.
Did run the inventory gate itself (`run_bb_suite.sh --dry-run`, which matches
no test name and inventory-only reports, executing nothing): confirms the
tree is still consistent — 360 files, 356 standing, 4 excluded.

| check | result |
|---|---|
| `test_lean_ledger_bb_wiring.sh` | ALL PASS (6/6, A1-3 + B1-3) |
| `bb_load_closure_agreement_test_runner.bb` | ok — 4 entry points agree |
| `suite_inventory_lib_test_runner.bb` | ok |
| `bl973_closure_guard_property_runner.bb` | 120 runs, ALL PROPERTIES HOLD (coverage matches architect's evidence exactly) |
| `bl973_suite_inventory_property_runner.bb` | 200 runs, ALL PROPERTIES HOLD (coverage matches architect's evidence exactly) |
| `readLiveRoleHeldTicketsCli.test.js` (vitest) | 8/8 |
| `npm run compile` (fresh `out/`, BL-497 precaution) | clean |
| BL-973 acceptance | 13/13 |
| BL-487 acceptance | 2/2 |
| BL-814 acceptance | 6/6 |

## Babashka degraded-fallback note (per qa_e2e_procedure item 6)

No mutation/CRAP/DRY tool wired for `.bb`/specs-pipeline sources (BL-472
deferred). Coverage here is the two BL-973 property runners plus the
cross-language `bb_load_closure_agreement_test_runner.bb` (BL-897 discipline:
independent second reachability implementation, not a "kept in sync"
comment) — this is the standing degraded fallback, at a materially higher bar
than the median `.bb` parcel, and it is what this evidence file confirms
still holds.

## No orphaned processes, no leaked fixtures

`pgrep -fl 'node --test|stryker|gherkin-mutator|mutationWorker|vitest'` clean
after every run. `git status --short` shows only the feature file's own
mutation-manifest update (see diff below) plus this evidence file — no stray
fixture directories.

## Verdict

Hardened. No code change needed beyond the acceptance-mutation manifest
stamp on the feature file itself (BL-113's own bookkeeping, not a fix).
Forwarded to documenter.
