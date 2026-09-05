# BL-1431 — architect pass, 2026-09-05

Ticket: BL-1431-one-land-plan-reads-one-tip
Role: architect
Commit reviewed: a6003f235f (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1431OneLandPlanOneTipSteps.js`) and full-repo:
  `Dependency-rule gate PASSED: no forbidden edges.` in both. The change is
  entirely in Babashka land-step code (`land_step_lib.bb`,
  `land_step_cli.bb`) plus a Babashka acceptance CLI and a thin Node step
  handler — no webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: `land_step_lib.bb` shows the wide standing
  coupling any change to this central land-step file always shows (its
  own long history of sibling tickets — BL-1272, BL-1297, BL-1332, BL-1339,
  BL-1343, BL-1354, BL-1374, BL-1385, BL-1389) — pre-existing structure,
  nothing new or suspicious.

## Invariants Review (BL-633/654) — traced by hand, not just tested

1. **One plan, one tip.** Structurally verified: `grep -n
   "(origin-main-sha root)"` returns exactly 7 hits, and every one is a
   default/base arity of a multi-arity function resolving for a
   standalone caller that has no already-resolved tip (`entangled-siblings`
   1-arity, `main-ticket-sources` 1-arity, `ticket-approval-state`
   1-arity, `own-paths`'s 3- and 6-arg arities, `land-plan`'s and
   `replay!`'s own entries when `opts` carries no `:origin-main`). Traced
   `land-plan`'s call chain by hand: it resolves once at its own entry
   (honoring an already-supplied `:origin-main` from the CLI via
   `(if (contains? opts :origin-main) ...)`), then passes that exact value
   positionally into `entangled-siblings` (6-arg call) and `own-paths`
   (8-arg call with `origin-main` as the last positional), which in turn
   thread it into `sibling-path-landed-fn` and the default `approval-fn`
   (`(fn [id] (ticket-approval-state root id origin-main))`) — no reader
   inside the plan's own walk re-resolves the ref. `land_step_cli.bb`
   resolves once at its true entry and passes the SAME sha into both
   `land-plan` and `replay!`.
2. **Publish unchanged.** `land_main_publish.sh` diff is empty (confirmed
   `git diff` shows zero changes to that file) — the FF-only push/single-
   rematch/never-force contract is untouched, exactly as invariant 2
   requires.
3. **Fail-open posture unchanged.** `land-plan`'s `origin-main` binding
   still short-circuits to `nil` when unresolvable and downstream reads
   still answer `{:action :escalate :reason "...could not be resolved"}`
   or `{:paths nil :warning "..."}` rather than guessing — unchanged shape,
   confirmed by reading the `if-not origin-main` branches in
   `entangled-siblings` and `own-paths`.

Independently re-ran the coder's property test and unit runner:

```
bb bl1431_one_land_plan_one_tip_property_runner.bb → 40 runs each,
  ALL PROPERTIES HOLD, coverage across explicit-origin-main,
  resolves-itself, multi-own, fails-first/fails-later branches
bb land_step_lib_test_runner.bb → ALL PASS
```

and the sibling land-step property suites for regression (per qa_e2e
item 1, "the BL-1389, BL-1375, BL-1354, BL-1343 and BL-1315 land-step
features still pass"):

```
bl1298_replay_worktree_property_runner.bb   → ALL PASS
bl1334_land_replay_approval_property_runner.bb → ALL PROPERTIES HOLD (48, exhaustive)
bl1374_sync_merge_passengers_property_runner.bb → ALL PROPERTIES HOLD (24 fixture runs)
```

No regression to any sibling land-step behavior.

## Acceptance wiring — driven end-to-end myself, real git fixtures

Feature declares 4 scenarios / 4 scenario runs. Ran all 4 fixture modes of
`bl1431OneLandPlanOneTipCli.bb` directly myself (real bare origin, real
worktrees, real mid-walk `git fetch`):

- `moving-tip`: `planStill` and `planMoving` are **structurally identical**
  JSON (same action, entangled, own-paths, passengers) despite
  `originMoved: true` and a real mint commit landing on the fixture's main
  mid-walk; `anyPathUnreadable: false` — invariant 1's exact claim,
  confirmed against the real library, not a mock.
- `resolved-once`: `callCount: 1` — `origin-main-sha` invoked exactly once
  for the whole plan computation, counted via a real call-counting seam
  around the git-level function.
- `no-origin`: `{"action":"escalate","reason":"land-step: origin/main
  could not be resolved"}` — fail-open, no guessed SHA.
- `moved-at-push`: real push rejected (`[rejected] ... fetch first`),
  exactly one `LAND_REMATCH`, `rematchCount: 1`, `forced: false`,
  `published: true`, `LAND_PUBLISHED` — the real `land_main_publish.sh`
  reconciling a moved origin with its existing single-rematch contract,
  untouched by this parcel.

All 4 match the feature's 4 scenario runs exactly. `registerSteps` export
present per the ticket's `required_wiring` anchor (BL-1371);
`grep -c origin-main-sha land_step_cli.bb` ≥ 1 confirmed (the CLI's own
entry resolution), and the reader-side anchor (`grep -c
"(origin-main-sha root)"` in reader functions is 0) is satisfied per the
structural trace above — every hit is a legitimate entry point, none a
mid-walk reader.

No leftover fixture temp dirs after my runs.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. This closes one of the two root
causes (the mint-vs-walk race) from the QA landing-difficulty survey I
sent the specifier earlier today. Forwarding to hardener.
