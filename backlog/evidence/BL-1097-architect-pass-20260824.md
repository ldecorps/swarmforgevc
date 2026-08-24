# BL-1097 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `86d11f933d` (on coder `2274b46dd2`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Apply Article 1.9's no-op rule to the coordinator router that ORIGINATES
parcels: refuse (exit 3) when the ticket already has a dispatch trail,
reusing the daemon's `decide-dispatch-gaps` predicate so router and
dispatch-gap sweep cannot disagree. `--force` for deliberate re-route;
fail-open if the trail CLI cannot answer.

Parcel surface: `chase_sweep_lib.bb` (`ticket-dispatched?` /
`dispatch-trail-dirs`), `dispatch_trail_cli.bb`, `route_backlog_to_coder.sh`,
`promote_and_route_next.sh`, `handoffd.bb` (delegate scan dirs), APS steps +
unit/property/shell suites. Cleaner fixed DOMAINS trailing comma so later
step modules still load.

## Architecture

- Matches approval recommendation: one shared predicate (invariant 2 by
  construction — `ticket-dispatched?` IS `decide-dispatch-gaps` for one
  ticket; dirs via `dispatch-trail-dirs` / `mailbox-dir`).
- Thin CLI seam for shell routers; policy stays in chase_sweep_lib.
- No webview/host boundary, secrets, or SwarmForge fork violation.
- Stamp-off tip hygiene: HOTFIX_PATHS match `27273f2b0a`; BL-1113
  acceptance 9/9; Spec/`&nbsp;` narrative aligned.

## Required hard gate

No `extension/src/**` production file in this parcel. Dep-gate N/A for
parcel paths under `extension/` (APS steps live outside depcruise cwd).

## Co-change

Expected coupling of router scripts ↔ chase_sweep_lib / handoffd. Advisory
only.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Router never originates parcel for finished work on cited trail | property runner + feature + shell 01–06 | Green |
| 2 | Router and dispatch-gap agree on dispatched? | `ticket-dispatched?` ≡ `decide-dispatch-gaps`; shell 07 + feature | Green |

## Property-testing support (undeclared)

Declared pair covered by `bl1097_router_no_op_origination_property_runner.bb`
(200 runs). No additional undeclared property authored.

## Correctness read-through

- Unit ALL PASS; shell 01–07 ALL PASS; acceptance 4/4; properties ALL PASS.
- Refusal leaves YAML untouched; promote-then-refuse explains exit 3.
- No defect spotted; no prior BL-1097 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked`,
commit = this evidence commit (BL-536 / BL-806).

By architect.
