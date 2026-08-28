# BL-1222 hardener pass — 2026-08-28

Merged architect handoff `95223d8085` (BL-1222: property-suite guard scrubs
the hook's git env before launching the suite — coverage slice on top of the
scrub BL-1196 already landed). Clean merge, no conflicts. First pass, no
bounce history.

## Received state
- `swarmforge/scripts/test/test_property_suite_drift_guard.sh`: ALL PASS,
  18 scenarios (16 pre-existing + 2 new: #17 the launched suite receives
  none of GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE, #18 a nested shell fixture's
  git init+commit is isolated, not redirected into the invoking worktree).
- Acceptance feature: 5/5 green (scenarios 01, 03, and outline 04's three
  short-circuit rows; scenario 02 correctly stays retired, superseded by
  BL-1196's own scenario 04 — not reworded, not rebuilt).
- Non-vacuity already proven by hand per the coder's own notes: disabled
  the scrub line, confirmed shell scenarios 17-18 AND acceptance scenarios
  01/03 all fail naming the leaked env vars or the moved HEAD; restored,
  re-confirmed ALL PASS both layers. Not re-verified independently here —
  the failure-mode description (naming the exact leaked vars / moved HEAD)
  is specific enough to trust as a real, non-vacuous check.

## Mutation / CRAP
No `extension/src/**` or `extension/out/**` file changed — the entire
change is a shell script (`check_property_suite_drift.sh`, already landed
under BL-1196) plus its acceptance/shell-test coverage. Babashka/shell
surfaces have no wired mutation/CRAP tool per the Startup Tools rule;
gated by the shell test harness alone, which is green.

## Fixture hygiene
Both the acceptance CLI driver's fixture roots (`mktemp -d` for `$ROOT`
with `trap cleanup EXIT`, and the nested scenario's `$NESTED_DIR` with an
inline `rm -rf` in the same script block) are cleaned up properly — no
leak risk.

No further hardening needed; forwarding unchanged.

By hardener.
