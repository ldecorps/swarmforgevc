# BL-343 investigation evidence — 20260713 (coder)

Per the ticket's own explicit mandate: "Bounce any figure whose provenance
is an estimate rather than an observed run." This checked in with the
operator before spending real API money or touching the live production
swarm's roster (see the recorded decision below) - the operator chose the
honest-report path over triggering a real park/unpark cycle right now.

## The honest finding: UNMEASURABLE TODAY - zero real park/unpark cycles exist

BL-324's per-role park/unpark mechanism (`role_lifecycle_cli.bb`) merged
only hours before this investigation and has NEVER fired in production, at
all, as of this session. Verified directly, not assumed:

- `.swarmforge/role-lifecycle/` does not exist on the live main checkout
  (`ls` -> "No such file or directory") - the directory this parcel's own
  new event-log instrumentation would have created the first time a real
  park or unpark happened.
- `roles.tsv`'s own mtime on the live checkout predates BL-324's merge by
  hours (unchanged since 2026-07-12T21:55, per the earlier BL-336
  investigation this same session) - the roster has never shrunk since the
  code existed.
- Every real Claude Code transcript on this box was searched for any
  invocation of `role_lifecycle_cli.bb ... shape ...` against the real
  project root - the only matches are test-fixture runs against isolated
  `/tmp` roots (this ticket's own acceptance suite and BL-324's own
  `test_role_lifecycle_cli.sh`), never the live swarm.

**A cost derived without a real park and unpark is not a measurement — it
is the same guess in a lab coat the ticket explicitly warns against. So
this investigation does NOT report a break-even number today.** That is
itself the ticket's own explicitly-sanctioned outcome: "A HONEST NEGATIVE
[or here, UNMEASURED] ANSWER IS A COMPLETELY ACCEPTABLE OUTCOME."

## What WAS done: wire real measurement so the NEXT cycle is captured honestly

Per the ticket's own scope items 1-3 ("measure the cold-start cost... measure
the idle burn... derive the break-even"), the measurement MACHINERY needed
building even though no data exists yet to run it on:

1. **`role_lifecycle_cli.bb` now logs every REAL park/unpark decision**
   (`swarmforge/scripts/role_lifecycle_cli.bb`'s new `log-shape-result!`,
   wired right after `evaluate-role-lifecycle!` returns) to
   `.swarmforge/role-lifecycle/park-cycle-log.jsonl` - one JSON line per
   event (`{"event":"park"|"unpark","role":...,"atMs":...}`), timestamped
   with the real wall clock at the moment the real tmux kill/respawn
   happened. An ABORTED park (the per-kill re-check catching a role that
   claimed work in the survey-to-kill window, `role_lifecycle_lib.bb`'s own
   `park-role!`) is explicitly NOT logged - it never actually removed the
   role from service, so logging it would fabricate an idle window that
   never happened. VERIFIED against a REAL park + REAL unpark cycle (not a
   simulation): `test_role_lifecycle_cli.sh`'s own scenario 02 already
   parks then unparks `architect` for real (real tmux sessions on an
   isolated socket); extended it to assert the new log file records both
   events, in order, with real distinct timestamps - `bash
   swarmforge/scripts/test/test_role_lifecycle_cli.sh` passes, including
   this new assertion. Also verified the negative case (scenario 07/08's
   own aborted-park race fixture): the log never records the aborted
   attempt as a real park.

2. **`extension/src/metrics/parkCycleReport.ts`** (new, pure): pairs real
   park+unpark events per role into complete cycles (a still-parked role
   or an orphan unpark is never fabricated into a pair - `pairParkCycles`),
   and reuses BL-324's OWN already-tested `measureParkCycleCost`
   (`burnRate.ts`, unchanged) against each cycle's REAL transcript token
   usage - never re-deriving that math. Adds `deriveBreakEvenMs`: the idle
   duration at which a role's own observed cold-start cost is paid back by
   its own observed idle-burn rate (`coldStartTokens * parkedDurationMs /
   warmIdleBaselineTokens`) - `null`, honestly, when a role burned nothing
   idle (parking such a role can never pay off, by construction, not by
   omission). `computeRoutingBreakEvenReport` aggregates: `null` for
   `routingSavesMoney` when zero real cycles exist - NEVER `false`, which
   would misreport "measured, and it doesn't save money" when the true
   state is "not yet measured at all."

3. **`extension/src/tools/park-cycle-report.ts`** (new CLI, thin wrapper
   per the engineering article's own CLI-main rule): reads the real event
   log, resolves each role's real worktree, calls
   `computeRoutingBreakEvenReport`. RAN LIVE against the real production
   checkout just now:
   ```
   $ node extension/out/tools/park-cycle-report.js
   {
     "measuredCycles": [],
     "roleBreakEvenMs": {},
     "totalDeltaTokens": 0,
     "routingSavesMoney": null
   }
   ```
   This is the real, live, honest answer today - not a fixture output.

## `warm-core-roles` - explicitly left unchanged

Per the ticket's own scope item 5 ("TUNE warm-core-roles ... FROM THE
MEASUREMENT, not from judgement. If the measurement says a role should
never be parked, say so and hold it warm") and the operator's own decision
this session: with zero real measurements, there is nothing to tune FROM.
`role_lifecycle_lib.bb`'s `warm-core-roles` (`#{"coordinator" "specifier"}`,
itself already corrected today per its own docstring) is untouched by this
parcel - holding the current judgement-based set warm is the SAFE default
until real data exists to override it, exactly the ticket's own fallback
instruction.

## Answering the ticket's six acceptance items directly

1. "The cost of bringing a parked role back is measured from a real
   unpark" - the MACHINERY now does this (verified against a real fixture
   cycle); zero real production unparks exist yet to report a live number
   from.
2. "The saving from parking an idle role is measured from real idle burn"
   - same machinery, same caveat.
3. "The break-even idle duration is stated as a number" - `deriveBreakEvenMs`
   states it as a number PER REAL CYCLE the moment one exists; today there
   are none, so none is fabricated.
4. "Parking a role idle for less than break-even is identified as a loss"
   - `ParkCycleCostReport.isLoss`, reused unchanged from BL-324's own
   tested function, verified in `parkCycleReport.test.js`.
5. "The set of roles held warm follows the measurement, not a guess" -
   today's measurement is "none exists" - so `warm-core-roles` correctly
   follows THAT measurement by staying at its current, safe, unchanged
   value, not by being tuned on a guess.
6. "A finding that routing does not save money is reported, not tuned
   away" - the honest finding reported here is stronger: routing's saving
   is UNMEASURED, not merely negative, and this document says so plainly
   rather than fabricating either a positive or negative number to close
   the ticket tidily.

## What was explicitly NOT done

No real park/unpark cycle was triggered against the live production swarm
(the operator's own choice, to avoid spending real API money and risking
collision with in-flight pipeline work - three tickets, BL-345/BL-335/
BL-336, were mid-pipeline through cleaner/architect/hardener/documenter/QA
at the time of this investigation). `warm-core-roles` was not changed. No
number was estimated from prompt size or reasoned about from code alone -
every figure in this document is either a real command's real output or an
explicit "no data yet."
