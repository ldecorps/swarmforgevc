# BL-1535 — architect review pass, bounce, 2026-09-11

Reviewed commit: 4483ad7e57 (cleaner's forward; coder's own commit a7b6ab41e4)

## Checklist run

- Dependency-gate (`extension/out/tools/dependency-gate.js`): inapplicable —
  every changed file is `.bb`, no TypeScript touched.
- Co-change report (`extension/out/tools/co-change-report.js`) against
  `handoffd.bb`/`mono_router_lib.bb`: only pre-existing hub-file baseline
  coupling (specs/pipeline/steps/index.js, chase_sweep_lib.bb,
  handoff_lib.bb, etc. — all long-standing, nothing newly introduced by
  this parcel). Not flagged as a defect.
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — PASS.
- `bash swarmforge/scripts/test/test_chase_departing_mid_parcel_gate.sh` —
  PASS, all 7 cases.
- `bash swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh` —
  PASS, all 12 cases (case 04 "daemon-initiated rotation is never gated on
  a stuck parcel" unchanged — rotate-resident-to! stays ungated).
- Acceptance: BL-1535's own feature (7/7), BL-805 (5/5), BL-926 (6/6),
  BL-938 (4/4) — all green.
- `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` — PASS
  (BL-967 closure/chokepoint gate; confirms the new `pgrep -P` call
  correctly routes through `daemon-cycle-guard-lib/sh!`, no raw subprocess
  call introduced).
- `handoff_lib.bb` diff vs main: empty — `rotate-resident-to!`/`respawn-as!`
  untouched, per the ticket's FIRM constraint.
- Invariants review: invariant 1 and 2 are correctly encoded by the bb
  runner assertions and the bash e2e fixture. Invariant 3 ("every refusal
  is observable... naming the departing role") is where D1 below lives.

## D1 — `:departing-parcel?` and `:departing-working?`/telemetry can resolve
to two DIFFERENT roles when the active-role marker diverges from the
resident pane's live identity (BL-927)

**Class:** behavior (correctness). **Blamed role:** coder.

`attempt-resident-rotate!` (handoffd.bb ~line 1723):

```clojure
(let [departing-role (handoff-lib/read-mono-router-active-role)   ; RAW MARKER
      session (handoff-lib/mono-router-resident-session)
      blocking-file (:blocking-file (handoff-lib/departing-role-blocking-handoff))  ; BL-927-RESOLVED
      footer-busy? (resident-pane-busy? socket)
      working-signal (departing-working-signal socket session departing-role footer-busy?)
      gate (mono-router-lib/should-rotate-resident?
            {:active-role departing-role
             ...
             :departing-parcel? (some? blocking-file)
             :departing-working? (some? working-signal)
             ...})]
  ...
  (log-chaser-telemetry! {:type "departing-mid-parcel" :role departing-role ...})
```

`departing-role-blocking-handoff` (handoff_lib.bb:983) is BL-927-aware: when
the active-role marker file disagrees with the resident pane's actual live
identity, it resolves `:role`/`:blocking-file` from the LIVE role, not the
stale marker (docstring: "the marker's OWN claim is never sufficient
evidence on its own"). `attempt-resident-rotate!` calls it but keeps only
`:blocking-file`, discarding the resolved `:role` — `departing-role` (fed
into `departing-working-signal` and the telemetry `:role` field) stays the
RAW marker from `read-mono-router-active-role`.

`departing-working-signal`'s `fresh-audit-challenge?` sub-check is
role-keyed (`audit_pending/<sha256(role)>/`). In the divergence case,
`blocking-file` names role A's (live, actual) parcel, but the audit-challenge
lookup and the telemetry `:role` field both name role B (the stale marker) —
two different roles inside the same gate decision.

**Failure scenario:** marker says `coder` (stale) but the resident pane's
live identity is actually `hardender` (a rotation landed and the marker
write raced/lost, or any other BL-921/BL-927-class divergence — the exact
class of bug those tickets exist for). `hardender` genuinely holds an
in_process parcel and stands mid-audit with a fresh challenge under
`audit_pending/<sha256("hardender")>/`. `departing-role-blocking-handoff`
correctly resolves to `hardender`'s blocking-file, so
`:departing-parcel?` is true. But `departing-working-signal` checks
`fresh-audit-challenge? "coder"` (the marker) — `coder`'s audit dir is
empty, footer reads idle, no live descendant under `coder`'s (nonexistent)
identity — so `working-signal` is `nil`, `:departing-working?` is false,
and the gate proceeds to rotate, displacing `hardender` mid-audit: exactly
the incident class this ticket exists to prevent. If it does refuse for
some other reason, the telemetry row also misattributes the incident to
`coder`, the wrong role — an invariant-3 violation either way.

No scenario in `test_chase_departing_mid_parcel_gate.sh` exercises this:
every case sets `LIVE_ROLE="hardender"` matching the marker exactly (the
script's own comment: "every scenario below is about the
departing-mid-parcel gate, not live/marker divergence"), so the gap is
real but untested, not caught by the green suite.

**Remediation:** destructure both fields from the one
`departing-role-blocking-handoff` call —
`{:keys [role blocking-file]} (handoff-lib/departing-role-blocking-handoff)`
— and use that resolved `role` (falling back to the marker only when it is
`nil`, matching `departing-role-blocking-handoff`'s own fail-open contract)
as the identity passed to `departing-working-signal` and to the telemetry
`:role` field, so `:departing-parcel?` and `:departing-working?`/the
telemetry always describe the SAME role. `:active-role` fed to
`should-rotate-resident?` can stay the raw marker (pre-existing, shared
with the untouched `:already-active`/`:busy` branches) — this fix is
scoped to the two new role-keyed lookups this ticket introduces.

By architect.
