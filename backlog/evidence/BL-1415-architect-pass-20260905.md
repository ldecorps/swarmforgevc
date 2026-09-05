# BL-1415 — architect pass, 2026-09-05

Ticket: BL-1415-a-dispatch-that-never-reached-its-recipient-is-lost-not-dispatched
Role: architect
Commit reviewed: 14b78c4f32 (cleaner NONE pass)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run on the new step handler: `0 clones`.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"One predicate... the router never re-derives it from the
   mailboxes"** — read `ticket-dispatch-verdict`: its `:dropped` branch
   calls `decide-dropped-parcel?` unchanged (confirmed via `git diff` —
   that function is byte-identical). `ticket-dispatch-verdict-in` builds on
   `build-dropped-parcel-trail-index`, the same single-pass reader the
   sweep uses. The router shells to the CLI and branches on its printed
   verdict string — never re-derives from mailboxes itself (confirmed by
   reading `route_backlog_to_coder.sh`'s diff).
2. **"The stall clock starts at the freshest of..."** — read
   `handoff-event-ms-from-headers`: takes `max` across all four
   timestamps. Confirmed both consumers (`handoff-event-ms`'s single-file
   read, `build-dropped-parcel-trail-index`'s single-pass loop) call this
   ONE function (`grep -n handoff-event-ms-from-headers` — two call sites,
   no second derivation) — BL-978 invariant 2 preserved by construction.
3. **"DISPATCHED... always refuses without --force; DROPPED... routes with
   a warning... missing data fails closed"** — confirmed via the shell
   test suite (`test_bl1097_router_refuses_dispatched_ticket.sh`,
   scenarios 08-10) and by reading `ticket-dispatch-verdict`'s `cond`:
   `not has-trail?` → `:undispatched`; the dropped-check only fires
   through `decide-dropped-parcel?`, whose own fail-closed posture (a nil
   `newest-trail-ms` never reads dropped) is unchanged and independently
   confirmed unit-tested.

## The `status: nil` design choice — independently traced, agree with the cleaner

`ticket-dispatch-verdict-in` deliberately passes `status: nil` (the
router/CLI path has no ticket file to read a `status:` field from). I
traced this against `parked-ticket?`'s own contract myself
(`= status "blocked"` exactly — `nil` is never a park) and confirm the
cleaner's reasoning: a parked ticket the sweep would suppress from its
own multi-ticket nudge can still answer `:dropped` when the router/CLI is
asked about it directly — this only ever WIDENS which single, named
tickets the router/CLI will report as dropped relative to what the sweep
itself would nudge for, never narrows past it. Since `route_backlog_to_coder.sh`
is always invoked for one specific, coordinator-named ticket (a deliberate
human/coordinator action), this is an acceptable, transparently-disclosed
scope choice, not a hidden gap.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `chase_sweep_lib.bb`, narrowed `handoff-event-ms-from-headers`
back to the pre-fix 2-field version (`enqueued_at`/`created_at` only),
reran the bb unit suite: **2 failures** — the `dequeued_at` and
`completed_at` freshness tests, exactly matching the coder's own claimed
non-vacuity result. Restored the file, confirmed byte-identical via
`diff` and `git status --short` (empty), reran — `ALL PASS` again.

## Independently re-verified the substance

- `bb swarmforge/scripts/test/dropped_parcel_test_runner.bb` — **ALL
  PASS**.
- `bb swarmforge/scripts/test/bl719_dropped_parcel_invariants_property_runner.bb`
  — **ok**.
- `bb swarmforge/scripts/test/bl1097_router_dispatch_trail_test_runner.bb`
  — **ALL PASS**.
- `bash swarmforge/scripts/test/test_chase_sweep.sh` — **ALL PASS**.
- `bash swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh`
  — **ALL PASS** (10/10, including the 3 new scenarios).
- `node specs/pipeline/cli.js
  specs/features/BL-1415-a-dispatch-that-never-reached-its-recipient-is-lost-not-dispatched.feature`
  — **6/6 pass**.
- `node specs/pipeline/cli.js` on `BL-1097`, `BL-1223`, `BL-1301`
  (dependencies/regressions) — **4/4, 6/6, 8/8 pass**, all unaffected.

All matching both the coder's and cleaner's claimed counts exactly.

## Test-scaffolding bugs the coder caught and fixed — reviewed, correctly diagnosed

Two genuine test-infrastructure bugs were caught and fixed before landing:
(1) a fixture `cwd` not pinned to the fixture root, which let
`swarm_handoff.sh` resolve its target via `git rev-parse --show-toplevel`
against the real session's own live repo instead of the fixture — the
exact BL-1390 cwd-scoping hazard class this codebase has hit before; (2)
fixture timestamps computed against a fixed historical instant rather than
the real wall clock the subprocess under test reads. Both fixes are
correctly reasoned and match established hazard classes rather than being
hand-waved — read the diffs directly, agree with the fixes.

## required_wiring

All three named anchors confirmed present by direct grep: `DROPPED` in
both `route_backlog_to_coder.sh` and `dispatch_trail_cli.bb`;
`completed_at` in `chase_sweep_lib.bb`; the new step handler discovered by
directory scan (BL-1371), confirmed by the acceptance run passing 6/6.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
