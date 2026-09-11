# BL-1535 — architect review pass, bounce 2, 2026-09-11

Reviewed commit: e3178fd17d (cleaner's forward; coder's own re-fix commit 07d5d699ad,
addressing round-1 D1 from `backlog/evidence/BL-1535-architect-bounce-20260911.md`)

## Checklist run

- Dependency-gate: inapplicable — every changed file vs the round-1 bounce is
  `swarmforge/scripts/handoffd.bb` (`.bb`), no TypeScript touched.
- Co-change report against `handoffd.bb`/`mono_router_lib.bb`: only frequency-1
  hits, below the min-frequency-3 threshold — no suspected coupling.
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — PASS.
- `bash swarmforge/scripts/test/test_chase_departing_mid_parcel_gate.sh` — PASS,
  all 7 cases.
- `bash swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh` — PASS,
  all 12 cases (case 04 and case 11 unchanged).
- Acceptance: BL-1535 (7/7), BL-805 (5/5), BL-926 (6/6), BL-938 (4/4) — all green.
- `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` — PASS.
- `handoff_lib.bb` diff vs main: empty — unchanged, per the ticket's FIRM
  constraint.
- Code read of the round-1 remediation: `attempt-resident-rotate!` now
  destructures `{:keys [role blocking-file]} (handoff-lib/departing-role-blocking-handoff)`,
  uses `departing-role (or role marker-role)` for both `departing-working-signal`
  and the telemetry `:role` field, and keeps `:active-role` as the raw marker
  for `should-rotate-resident?`. This matches round 1's remediation exactly and
  is the ONLY file that changed between the bounced commit (4483ad7e57) and this
  one (confirmed: `git diff 4483ad7e57 07d5d699ad` touches
  `swarmforge/scripts/handoffd.bb` alone — `mono_router_lib.bb`, the bb runner,
  the step handler and the feature file are byte-identical to the bounced
  version).
- Invariants review: invariant 1 and 2 remain correctly encoded. Invariant 3
  ("every refusal is observable... naming the departing role") is where D1
  below lives — same invariant round 1 flagged, now about test coverage rather
  than the code.

## D1 — the exact marker/live-role divergence scenario the round-1 defect lived
in has ZERO regression coverage anywhere in this parcel

**Class:** invariant-unencoded. **Blamed role:** coder.

Round 1's defect (D1, `BL-1535-architect-bounce-20260911.md`) was that
`attempt-resident-rotate!` fed `departing-working-signal` and the telemetry
`:role` field the raw active-role marker while `:departing-parcel?` came from
the BL-927-resolved LIVE role — silently misattributing a refusal, or worse,
failing to refuse at all, when the marker diverges from the resident pane's
live identity. That was the exact incident class this ticket exists to
prevent, and round 1's own evidence noted: "No scenario in
`test_chase_departing_mid_parcel_gate.sh` exercises this... the gap is real
but untested, not caught by the green suite."

Round 2 fixes the code (confirmed correct by inspection above) but adds no
test anywhere that exercises a marker/live-role divergence through
`attempt-resident-rotate!`. Every scenario in
`test_chase_departing_mid_parcel_gate.sh` still sets `LIVE_ROLE` to match
`mono-router-active-role` exactly (the file's own comment, unchanged since
round 1: "every scenario below is about the departing-mid-parcel gate, not
live/marker divergence (that is BL-927's own fixture)"). The sibling fixture
it points to, `test_rotate_to_role_stuck_parcel_gate.sh` cases 10/11, drives
`departing-role-blocking-handoff`/`rotate-resident-to!` directly — a
completely different call path from `attempt-resident-rotate!`'s own local
`departing-role`/`working-signal`/telemetry wiring that round 1 found broken
and round 2 fixed. Confirmed via `grep -rn attempt-resident-rotate
swarmforge/scripts/test/`: `test_chase_departing_mid_parcel_gate.sh` is the
ONLY test that calls `attempt-resident-rotate!` at all, and it never varies
the marker independently of `LIVE_ROLE`.

**Failure scenario:** a future edit reintroduces round 1's bug (e.g.
re-inlining `(handoff-lib/read-mono-router-active-role)` in place of the
destructured `role`, or fixing only one of the two call sites) and every test
in this parcel — the bb runner, both bash fixtures, all four acceptance
features — stays green, because none of them ever sets `LIVE_ROLE` different
from the marker while driving `attempt-resident-rotate!`. The regression
ships silently a second time, invariant 3 unobserved, exactly as before.

The fixture already has everything needed to close this: `LIVE_ROLE` is
already threaded through the fake `tmux`'s `pane_start_command` output
(`test_chase_departing_mid_parcel_gate.sh` line ~39), and
`test_rotate_to_role_stuck_parcel_gate.sh` cases 10/11 already show the
pattern for setting the marker file and `LIVE_ROLE` to different roles in the
same fixture family.

**Remediation:** add one case to `test_chase_departing_mid_parcel_gate.sh`
that sets `mono-router-active-role` to one role (e.g. `coder`) and
`LIVE_ROLE` to a different role (e.g. `hardender`) that holds a real
in_process parcel and a working signal (live descendant process or fresh
audit challenge), drives the real `attempt-resident-rotate!`, and asserts
both: (a) the gate refuses (`:departing-mid-parcel`, since the LIVE role's
parcel is what should block, not the marker's), and (b) the telemetry row's
`:role` names the LIVE role (`hardender`), never the marker (`coder`) — the
two assertions round 1's bug would have failed on both counts. This is the
regression test invariant 3 requires for the scenario the ticket's own
incident and round 1's bounce were both about.

By architect.
