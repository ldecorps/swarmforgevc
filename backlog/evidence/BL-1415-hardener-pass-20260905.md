# BL-1415 — hardener pass, 2026-09-05

Ticket: BL-1415-a-dispatch-that-never-reached-its-recipient-is-lost-not-dispatched
Commit reviewed: 5f7360dff0 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/dropped_parcel_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/bl719_dropped_parcel_invariants_property_runner.bb` | ok |
| `bb swarmforge/scripts/test/bl1097_router_dispatch_trail_test_runner.bb` | ALL PASS |
| `bash swarmforge/scripts/test/test_chase_sweep.sh` | ALL PASS |
| `bash swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh` | ALL PASS (10/10, including scenarios 08-10) |
| `node specs/pipeline/cli.js specs/features/BL-1415-...feature` | 6/6 pass |
| `node specs/pipeline/cli.js` on BL-1097, BL-1223, BL-1301 (dependencies) | 4/4, 6/6, 8/8 pass |
| `npx jscpd` on the new step handler | 0 clones |
| Live smoke: `bb dispatch_trail_cli.bb . dispatched BL-9999999-nonexistent` | `UNDISPATCHED` |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently confirmed no fixture leak into the live mailbox

Checked `find /home/carillon/swarmforgevc/.swarmforge -name "*.handoff"
-newer .git -mmin -20` after running the acceptance feature: several
recent files exist, but all are genuine live coordinator traffic (e.g. a
real "BL-9001-demo" ticket, distinct from this ticket's own fixture id
"BL-9001") unrelated to this session's own hardening pass — confirmed by
reading their content directly. No fixture artifact leaked, independently
confirming the coder's own cwd-pinning fix (the exact BL-1390 hazard
class the coder caught and fixed before landing) holds.

## Independently read both mechanisms directly

- `chase_sweep_lib.bb:1525-1543` (`handoff-event-ms-from-headers`): takes
  the max of `enqueued_at`/`created_at`/`dequeued_at`/`completed_at`,
  `nil` when none parse. Confirmed both consumers
  (`handoff-event-ms`'s single-file read at line 1551,
  `build-dropped-parcel-trail-index`'s single-pass loop at line 1645)
  call this ONE function — BL-978 invariant 2 preserved by construction.
- `chase_sweep_lib.bb:1708-1738` (`ticket-dispatch-verdict`/
  `ticket-dispatch-verdict-in`): the `:dropped` branch calls
  `decide-dropped-parcel?` unchanged; `:reason` is
  `dropped-parcel-note-message`, the same text the sweep's own nudge
  produces — no duplicated message string. `status: nil` in
  `ticket-dispatch-verdict-in` only ever widens which single named tickets
  answer `:dropped` relative to the sweep's own multi-ticket suppression,
  confirmed by reading `parked-ticket?`'s contract (`= status "blocked"`
  exactly — `nil` is never a park).
- `dispatch_trail_cli.bb:77-79` and `route_backlog_to_coder.sh:105-122`:
  the three-way branch and the `DROPPED` routing-without-`--force` case
  match `required_wiring` exactly.

## Independently reproduced non-vacuity myself (not just trusted)

Narrowed `handoff-event-ms-from-headers` back to the pre-fix two-field
version (`enqueued_at`/`created_at` only, dropping `dequeued_at`/
`completed_at`), re-ran the bb unit suite: **2 failures** —
`newest-trail-event-ms: dequeued_at is fresher than a much older
created_at` and `...completed_at, fresher still, wins over dequeued_at
and created_at` — matching the coder's and architect's own claimed
non-vacuity result exactly. Restored the file, confirmed byte-identical
via `diff` and `git status --short` (empty), re-ran — ALL PASS again.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 02, 2 examples, 1 mutable column = 2
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **2 mutants, 2 killed, 0
survived** — manifest confirms
`"Total":2,"Killed":2,"Survived":0,"Errors":0"`. Scenarios 01, 03, 04, 05
are plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Babashka files carry no mutation/CRAP/DRY tooling (BL-472 deferred,
Engineering Rules) — gated by the unit-test pass/fail plus the clean
BL-113 gherkin-mutation pass above. jscpd confirms zero duplication in the
new step handler.

## Verdict

No defect. Forwarding to documenter.
