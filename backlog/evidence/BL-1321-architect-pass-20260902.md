# BL-1321 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1321-swarm-stamp-seated-preferred-yield-3d70c0f4ec.

## Received
Cleaner commit `b391e51498` (clean sweep, forward unchanged). Merge also
carried unrelated in-flight history (BL-1319 specifier spec-amendment,
already forwarded past architect earlier this session; BL-1298's promotion
to `backlog/done/M8/`) — riding along, not this parcel's own work, no
action needed.

## Scope check
Stamp-off review of already-landed hotfix `3d70c0f4ec`. Confirmed by
`git log abbf9cc44f..b391e51498 -- mono_router_lib.bb handoffd.bb
mono_router_lib_test_runner.bb backlog/hotfix-ledger.yaml` — empty: no
hotfix source or ledger touched by this parcel. The only landed files are
the acceptance step handler, its bb decision-driver CLI, and the `index.js`
registration.

## Dependency gate / co-change (BL-259/BL-255)
No JS/TS source file changed by this parcel — nothing to run either tool
against. (The step handler is JS but acceptance-domain content, outside
the dependency-gate's forbidden-edge concerns for production code.)

## required_wiring — both anchors confirmed live
- `specs/pipeline/steps/index.js` registers
  `bl1321SeatedPreferredYieldStampSteps` — 1 match.
- `handoffd.bb:1518` calls `mono-router-lib/chase-rotate-decision` from
  `chase-rotate-to!` — the live daemon chase path really does call the
  reviewed gate.

## Verification (independent re-run)
- `node specs/pipeline/cli.js
  specs/features/BL-1321-swarm-stamp-seated-preferred-yield-3d70c0f4ec.feature`
  — 9/9 pass, including scenario 03 (stale-marker direction), 04
  (line-ending report), 08 (normalisation reported not undone), 09 (review
  never self-certifies).
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — ok.
- `bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh`
  — ALL PASS (BL-795 redirect regression intact).
- `git diff 3d70c0f4ec HEAD -- mono_router_lib.bb
  test/mono_router_lib_test_runner.bb` — empty: byte-identical to what
  landed, confirming the coder/cleaner's claim independently.
- Ledger row for `3d70c0f4ec`: `state: stamp-open`, `human_decision: null`
  — unmodified.

## Invariants Review (BL-633/654)
Three declared invariants, all correctly not converted to property tests
per the coder's stated reasoning (invariants 1/2 are process assertions
over repo state; invariant 3 covers a pure function over a small enumerated
input space, exhaustively covered by the Examples table rather than
generated sampling — a reasonable choice, not an omission).
1. Never reimplements — confirmed via empty git log above.
2. Green never certifies — ledger row unmodified, confirmed above.
3. BL-795 redirect still fires wherever preferred is not the seated role —
   scenario 03 re-drives the real gate with the marker naming a different
   role and confirms `{redirect, target}` still comes back; independently
   re-ran the acceptance suite and confirmed this scenario passes.

## Findings reported (not architect's to act on)
- Six asserts / five distinct cases (one byte-identical duplicate) —
  correctly reported, not deleted (constraint forbids removing a landed
  assert).
- CRLF→LF re-line-ending of the two files — human ruling already accepted
  option 1 (no follow-up); confirmed no further file in the parcel was
  re-line-ended, and no design defect found in the marker-vs-live-identity
  choice that would warrant a follow-up ticket.

## D1..Dn (Article 4.4 complete inventory)
NONE. Clean sweep — no hotfix source touched, ledger untouched, both
required_wiring anchors live, all invariants held, all 9 scenarios pass,
byte-identical diff against the landed commit confirmed independently.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
