# BL-1217 hardener pass — 2026-08-28

Merged architect handoff `b38c4a82b3` (clean pass, RC config gate verified
non-vacuous against the pre-fix baseline). No conflicts. This batch also
carried BL-1211's own further-progressed work
(`bounceResurrectionGitAdapter.ts`/`bounceResurrectionVerdict.ts`, a
`rule_proposal`-derived sibling of BL-1208's restoration-not-authorship
guard) riding along via shared branch history — not part of this ticket's
own scope, not touched here.

## Mutation approach

Pure Babashka, no wired mutation/CRAP/DRY tool for this surface. Hardening
below is hand-authored mutation on the two new predicates, matching the
BL-638 fallback discipline.

## Hand-verified, both non-vacuous

1. `remote-control-off-in-conf-text?`'s core comparison
   (`(= "off" (raw-config-value ...))`) flipped to `not=` in the compiled
   file — caught immediately, not just by the new BL-1217 scenarios but
   by pre-existing scenario 04 too (fast regression signal).
2. `expected-rc-name`'s `(when-not (remote-control-configured-off? ...) ...)`
   guard flipped to `when` (inverting the gate) — caught immediately by
   the same scenario 04.

Both restored; `test_remote_control_health.sh` returns to `ALL PASS`
after each restore.

## Fail-open-on-unreadable-conf constraint — confirmed already covered

The ticket's own constraint ("Unreadable conf file fails open to 'on',
never a spurious `:off`") has no test with that exact framing, but
traced scenario 22 ("absent remote_control config key is indistinguishable
from explicit on") and found it already exercises this exact path: the
scenario does `rm -f "$ROOT/swarmforge/swarmforge.conf"` — the SAME path
`backlog-depth-lib/conf-file-path`'s fallback resolves to for this
fixture (confirmed via the shell test's own diagnostic line: "falling
back to the tracked default conf .../swarmforge/swarmforge.conf") — so
`slurp` on that now-missing file throws, is caught by
`remote-control-configured-off?`'s `(catch Exception _ "")`, and the
scenario's own assertion (`status == "degraded"`, i.e. behaves as "on")
IS the fail-open proof, even though the scenario's name describes the
absent-KEY case rather than the absent-FILE case. No new test needed;
recorded here so a future pass doesn't have to re-derive this.

## Verification

- `test_remote_control_health.sh`: 22/22 pass (unchanged from architect's
  own count; my mutation probes restored cleanly each time).
- `run_acceptance.sh` on the BL-1217 feature, 3 consecutive runs: 8/8
  pass every run.
- Fixture lifecycle: step handler uses the shared
  `mkSocketFixtureRoot`/`releaseSocketFixtureRoot` helper (same as
  BL-1219's file), which carries its own process-exit backstop for the
  throw-before-cleanup leak class found in BL-1204's pass — no separate
  check needed here, already covered structurally.

## Cleanup

No orphaned `node --test`/`stryker`/`bb` processes at handoff. Both
hand-mutated files restored from `.bak` copies and confirmed byte-
identical (`git diff` empty) before moving to the next probe.

By hardener.
