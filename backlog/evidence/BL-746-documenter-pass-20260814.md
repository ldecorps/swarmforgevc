# BL-746 — documenter pass, 2026-08-14

## Scope

Received from hardener as `merge_and_process hardender 2ea4aaf802` —
hardener's re-verify pass after architect's D1 fixture-leak bounce was
fixed by coder and re-confirmed by architect
(`backlog/evidence/BL-746-architect-pass-20260814-bounce-verify.md`).
Bounce chain (QA -> architect -> coder -> architect -> hardener) is fully
closed; this parcel now reaches documenter under BL-746's own task name
(not folded silently into another ticket's chain — the earlier routing gap
this documenter itself flagged, `BL-746-documenter-routing-gap-20260814.md`,
is resolved: an architect-authored commit/evidence trail now exists).

## What changed (user/developer-facing)

`test_lifecycle_script_scope.sh`'s stop-path scenarios (04, 05, clean-
fixture, and new scenario 06) now drive the real repo-root `stop-swarm.sh`
end to end instead of re-deriving its refuse/success branching inline.
Purely test-infrastructure — no new command, flag, or user-visible
behavior in `stop-swarm.sh` itself, which is unchanged.

## Doc fix made

`docs/how-to/BL-637-lifecycle-script-scope.md` line 30 quoted the stale,
never-actually-real success string `"full stack SUCCESS — clean slate"` —
the exact reimplementation wording this ticket's own defect report is
about (the old shell test's hand-rolled reimplementation printed that
string; the real `stop-swarm.sh:96` has always printed
`"full stack SUCCESS — no known survivors"`). Corrected the quoted string
to match the real script (confirmed live via `grep -n SUCCESS
stop-swarm.sh`), and added a sentence documenting the second, independent
`kill_rc` refuse gate (`stop-swarm.sh:91-94`) that this ticket added test
coverage for but the doc never mentioned — both gates must pass before the
success line prints.

No "Last Updated" or freshness field exists on this doc (42 lines, no such
field) — no date bump applicable.

## Other docs checked, no change needed

- `docs/index.md` — does not list `BL-637-lifecycle-script-scope.md`
  (pre-existing gap, not introduced by this parcel; out of this ticket's
  scope to fix).
- `docs/diagrams/` — no diagram references `stop-swarm.sh`,
  `stack_survivor_scan`, or `test_lifecycle_script_scope.sh`; this parcel
  changes test-suite internals only, not pipeline/architecture topology —
  no diagram update required.
- `docs/reference/Specification.MD` — not touched by this change; no
  content here to update.

## Verification

- `bash swarmforge/scripts/test/test_lifecycle_script_scope.sh` — 15/15 PASS
  (re-run independently).
- No production code or tests touched by this pass, only the one doc file.

Forwarding to QA.

By documenter.
