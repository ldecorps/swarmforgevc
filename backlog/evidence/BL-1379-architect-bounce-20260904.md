# BL-1379 — architect review, 2026-09-04: BOUNCE

Reviewed coder commit `b9358ea76c` (merged in via cleaner `abb714f24d`,
fast-forward).

## Checks that passed

- Dependency gate on `specs/pipeline/steps/bl1379ParkReversalSteps.js`:
  PASSED, no forbidden edges.
- Co-change on `expedite_cli.bb`/`expedite_lib.bb`: expected hub coupling
  within the expedite family; no new smell.
- `expedite_lib_test_runner.bb`, `expedite_lib_property_runner.bb` (500
  runs each), `expedite_announce_lib_test_runner.bb` — all green, re-run.
- `run_acceptance.sh` on the BL-1379 feature — 9/9 on the amended feature
  (option 3, `status: blocked` + `freshness_check`), re-run.
- BL-567 scenario 18 correctly retired (removed, not reworded) and its
  mutation manifest correctly left untouched (`git show` on the retiring
  commit shows zero manifest-line changes, only scenario text removed).
- Invariant 1 read structurally: `unpark-plan` iterates `(:parked record)`
  — the run's own durable record — and never scans `backlog/hold/`'s
  directory contents, so a human-held ticket outside the record is never
  even considered, not merely skipped.
- The `status: blocked` + `freshness_check`/`freshness_check_reason` mark
  (`freshness-mark` in `expedite_lib.bb`) correctly rides
  `promotion_gates_lib.bb`'s existing gate rather than inventing a new one
  — verified in the coder's own evidence against the REAL gate, and the
  mark is set-only by this code, never cleared by it (matches the ruling:
  "clearing is the coordinator's, after deprecate-check.js allows").

## D1 — the reversal is never wired to its own trigger; the ticket's headline behavior does not exist in production (correctness, blames coder)

**The ticket's own title is "...reverses itself when the expedition
lands." It does not — nothing calls the reversal, ever.**

`unpark-parked!` (`swarmforge/scripts/expedite_cli.bb:468`) is fully
built, unit-tested, property-tested, and acceptance-tested — but:

```
grep -rn "unpark-parked!" swarmforge/scripts/*.bb
# swarmforge/scripts/expedite_cli.bb:468:(defn unpark-parked!    <- only its own definition
```

No other file, script, or CLI subcommand calls it. `expedite_cli.bb`'s
own `-main` runs teardown -> stages -> restart -> exit in one process and
never calls `unpark-parked!` either — which matches the ticket's own
"Teardown is the wrong moment" direction, since the expedition's process
exits long before the ticket's commit actually lands on `main` (QA lands
it later, in a separate process, per the live BL-1375 incident this
ticket is about). I grepped every land-related script this session has
already reviewed in depth (`land_step_lib.bb`, `land_step_cli.bb`,
`land_main_publish.sh`) plus `QA.prompt` and the expeditor docs for any
new call, hook, or documented manual step: none exists.

**The acceptance suite cannot catch this because it does not drive the
real trigger.** `specs/pipeline/steps/lib/bl1379ParkReversalCli.sh` calls
`expedite-lib/unpark-plan` — the PURE lib function — directly:

```clojure
(load-file (System/getenv "BL1379_LIB"))
...
(let [plan (expedite-lib/unpark-plan {:record record :landed? (landed?) ...})]
  ...
  (expedite-lib/unpark-report plan))
```

never `expedite_cli.bb`'s `unpark-parked!` wrapper, and never whatever the
real QA land path is supposed to call. This is the identical
fixture-vs-production gap Article 4.4 and this session's own BL-1386
bounce already named: it proves the DECISION LOGIC is correct in
isolation, and says nothing about whether anything in production ever
reaches it.

**The ticket's own `notes:` anticipated exactly this risk and asserted it
was covered — which is now shown false, not merely unconfirmed:**

> No `required_wiring:`. The reversal's call site is the land step, which
> is itself being changed by this ticket, so any anchor would be
> satisfied by the parcel's own diff... The acceptance scenarios exercise
> the real land path instead, which is what actually proves reachability
> here.

The land step is not changed by this parcel (no diff to
`land_step_lib.bb`/`land_main_publish.sh`/QA's land flow exists), and the
acceptance scenarios do not exercise it. Both halves of the notes' own
reachability argument are false on this diff.

**Live consequence, unresolved by this parcel:** the exact incident the
ticket was minted from — BL-1296, BL-1309, BL-1356, BL-1359, BL-1360
parked by BL-1375's run and never reversed — remains unreversed after
this parcel, because nothing new would have called the reversal even had
this parcel already been on `main` when BL-1375 landed.

**Fix, not mine to write:** wire `unpark-parked!` (or an equivalent
entry point) into whatever process actually observes an expedition's
commit landing — most plausibly QA's land step (`land_step_lib.bb` /
`land_main_publish.sh`, both already reviewed extensively this session)
checking for a `.swarmforge/expedite/<ticket>/park-record.json` and
calling the reversal when the just-landed commit is the expedition's own,
or a documented mandatory QA post-land step if a code hook is judged out
of scope — then extend the acceptance fixture to drive that REAL call
site (not the pure lib function) as the reachability proof the ticket's
own notes already claim to have.

## Verdict

NOT COMPLIANT. Correctness defect (D1) — the parcel's entire stated
purpose (an expedition's park reverses itself on land) has no live
trigger anywhere in the codebase; only the decision logic exists, unwired
and unreachable. Bouncing to coder.
