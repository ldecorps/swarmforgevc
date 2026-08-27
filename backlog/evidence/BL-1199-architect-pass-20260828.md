# BL-1199 architect pass — 2026-08-28

## Reviewed commit

`eaa72408cb` (cleaner, on coder commit `c378125d1`), merged clean into
architect (`Merge cleaner handoff eaa72408cb for BL-1199`).

## Deliverable 1 — ancillary start asserts, does not assume

`start_ancillary_services.sh`'s named-tunnel block now re-reads the
recorded `resident-spy-cloudflared.pid` and confirms liveness via
`named_tunnel_liveness_check.bb` after the launcher returns, instead of
trusting its exit code. `NOT_CONFIGURED` (exit 2) is a no-op (matches the
ticket's "absent tunnel is not a fault" constraint); `DOWN` (exit 1) gets
exactly one bounded relaunch (`launch_resident_spy_tunnel.sh` is already
idempotent, confirmed by reading it — untouched by this ticket per its own
constraint), then a loud report naming the *named* tunnel specifically.
Verified by direct read of the diff — the launcher's own behavior is
unmodified.

## Deliverable 2 — two rows, not one

`swarm_status.bb`'s `cloudflare-tunnel` row (sourced from `tunnel.pid`,
actually the editor tunnel) is renamed `vscode-tunnel`; repo-wide grep
confirms the old name had no other consumer before the rename (matches the
ticket notes' own pre-check). A new `bubble-cloudflared` row
(`gather-bubble-cloudflared`) observes `resident-spy-cloudflared.pid`
independently via the same shared predicate. `required_wiring`'s anchor
(`swarm_status.bb::bubble-cloudflared`) is satisfied — the row is actually
rendered by `gather-daemons`, not just a helper nothing calls.

## Architecture review

- `named_tunnel_liveness_lib.bb`: pure decision (`liveness-verdict`) takes
  only `{configured? pid-alive?}` — no third input for "what the OTHER
  tunnel's pidfile says" exists, so a caller cannot structurally wire it to
  the wrong pidfile. `configured?` reads one env file and is the file's own
  documented, deliberate exception to the pure/IO split (both callers need
  byte-identical config-detection, unlike the pidfile reads which
  legitimately differ per adapter) — reasoned, not accidental.
- Cleaner's follow-up commit correctly deduped `configured?` out of both
  `named_tunnel_liveness_check.bb` and `swarm_status.bb` into the shared
  lib — exactly the drift risk the ticket's own rationale calls out. No
  behavior change; I re-ran the full suite below after the dedupe and it is
  still green.
- Two real adapters (`named_tunnel_liveness_check.bb`'s CLI wrapper for the
  bash caller, `swarm_status.bb`'s `gather-bubble-cloudflared` for the
  babashka caller) both delegate the actual verdict to the one shared
  predicate — no hand-rolled duplicate decision logic anywhere.
- No `extension/` files touched — dependency-cruiser gate has nothing to
  check for this parcel. Ran the co-change tool anyway against the changed
  `swarmforge/scripts/*` files: the only "suspected coupling" flagged is
  `start_ancillary_services.sh`'s long-standing structural coupling to the
  rest of the ancillary-service family (`stop_ancillary_services.sh`,
  `operator_runtime_supervisor.bb`, etc.) — pre-existing repo-wide history,
  not something this ticket introduced or should have modularized further.

## Invariants review

Both declared invariants are encoded as ONE property test
(`named_tunnel_liveness_lib_property_runner.bb`, 200 seeded runs, all 4
`(configured?, pid-alive?)` branches hit) rather than hand-verified:

1. "No tunnel status row is ever derived from a different tunnel's
   pidfile" — the structural half is `liveness-verdict`'s own signature
   (no wrong-pidfile input possible); the wiring half (both real call
   sites read `resident-spy-cloudflared.pid`, never `tunnel.pid`) is
   proven concretely by acceptance scenario 02 (vscode-tunnel and
   bubble-cloudflared diverge independently in both directions).
2. "Liveness is never inferred from a launcher's exit code" — the
   predicate has no exit-code input at all; `:up` is only reachable when
   `pid-alive?` was actually true. Non-vacuousness confirmed directly: the
   runner defines a `broken-trusts-configuration-alone` mutant (reports
   `:up` once merely configured) and asserts it WOULD wrongly pass while
   the real implementation correctly reports `:down` for the same facts —
   the exact incident shape.

Not vacuous, not hand-waved. Both invariants have a live encoding and I ran
it directly rather than trusting the commit message.

## Verification (run directly)

- `bb .../named_tunnel_liveness_lib_property_runner.bb` — ALL PROPERTIES
  HOLD, 200 runs.
- `bb .../named_tunnel_liveness_lib_test_runner.bb` — ALL PASS.
- `bb .../swarm_status_lib_test_runner.bb` — ok.
- `bash .../test_named_tunnel_liveness_ancillary_start.sh` — ALL PASS (2
  scenarios: asserts+relaunches+names the named tunnel; a genuinely live
  tunnel passes with no relaunch/false report).
- `bash .../test_swarm_status_bubble_tunnel_row.sh` — ALL PASS (4 cases,
  including "the old ambiguous cloudflare-tunnel row name no longer
  appears anywhere" and the not-configured-never-down constraint).
- `specs/pipeline/steps/index.js:820` registers
  `bl1199PackSwitchBubbleTunnelSteps` — confirmed present, and I ran the
  feature end-to-end via `node specs/pipeline/cli.js
  specs/features/BL-1199-...feature` against the real, unmocked scripts:
  3/3 scenarios pass (scenario 01 + both Scenario Outline examples of
  scenario 02). Fixture cleanup verified: after a fresh run, no
  `/tmp/bl1199-*` directories are left behind (stale ones from an earlier
  pre-dedupe run were present before I re-ran and confirmed they clear).

## Disposition

Architecturally compliant: correct pure/IO split with one documented,
reasoned exception; both declared invariants live-encoded, non-vacuous,
and verified; acceptance scenarios pass against the real scripts, no
mocking. No correctness defect spotted. Forwarding to hardener.
