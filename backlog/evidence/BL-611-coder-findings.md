# BL-611 — coder findings and judgment calls (2026-08-01)

Implementation is complete and the full 17-scenario acceptance suite passes
(`specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature`),
plus all 4 KEEP-listed test runners, BL-675/BL-690/BL-637 regression suites,
and the full extension unit suite (399 files / 7052 tests). Several things
surfaced during implementation that need specifier awareness or a future
ticket; none blocked this parcel, but each involved a judgment call worth
recording rather than silently deciding.

## 1. `babysitter_lib.bb` KEEP-list claim is factually inaccurate

The 2026-07-25 amendment's KEEP list says `babysitter_lib.bb` has "zero agent
references by inspection." By direct inspection its entire content
(`should-fire-observe?`, `format-wake-message`, etc.) is LLM-wake scheduling
for the retired agent — messages like "Telegram the glitch", "do NOT restart
the swarm", "the babysitter runtime will wake you again." This directly
tensions with scenario 15's "no ... wake runtime remains."

Resolved conservatively: kept the file untouched (KEEP list is explicit and
recent; deleting on a factual-error theory risked destroying something the
specifier deliberately wanted preserved). It is now dead-but-tested code,
allowlisted in the scenario-15 scan alongside the other salvaged pure libs.
Flagging so a future amendment can decide deliberately rather than by
accident.

## 2. `kill_all_swarm.sh` vs BL-637's pipeline-only boundary

BL-611's required_wiring and scenario `kill-all-includes-babysitterd-03` both
require `kill_all_swarm.sh` to signal babysitterd's pidfile. BL-637
(2026-07-30, already shipped with its own tested contract) made
`kill_all_swarm.sh`/`kill_pipeline_swarm.sh` deliberately pipeline-only —
explicitly NOT touching ancillaries, verified by `test_lifecycle_script_scope.sh`.

Resolved by a narrow, additive, reversible change: `kill_all_swarm.sh` (the
"legacy alias" file only, NOT `kill_pipeline_swarm.sh`, the "preferred" name
BL-637 tests exercise directly) now also signals babysitterd's pidfile before
delegating, with its own `--help` text updated to document the one exception.
`kill_pipeline_swarm.sh` itself is untouched — every existing BL-637
scenario still passes. If this reads as the wrong call, it is a one-line
revert (`swarmforge/scripts/kill_all_swarm.sh`).

## 3. `babysitter_assess.bb` is pre-existing, unrelated, already-broken code

Calls undefined symbols (`babysitter-assess-lib/assess-agent`,
`mono-router-standing-roles`, `summarize-assess`, `format-assess-report`,
`format-telegram-glitch` — none exist in `babysitter_assess_lib.bb`). Verified
this predates BL-611 entirely (fails identically against the file as it stood
before any of my edits) and has zero callers anywhere in the repo. Not
touched — fixing it is a different ticket's scope. The KEEP list's mention of
"`babysitter_assess_lib.bb` + `babysitter_assess.bb`" as one unit conflates a
working file with a dead one; only the `_lib.bb` half is real.

## 4. BL-631 (paused, unimplemented) presumes a wake-queue this design doesn't have

`specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature`
(status: `backlog/paused/`, no step handlers, not yet implemented) has a
scenario asserting a critical finding "reaches the wake queue in the same
shape as a claim-progress finding." BL-611's shipped design has no wake
queue at all — findings are computed fresh each sweep and nudges dedup via
`.swarmforge/babysitterd/nudge-dedup.json`, not a persisted queue file. BL-631
will need its acceptance reworked against the actual babysitterd contract
(assemble-findings / decide-nudges) before it can be implemented.

## 5. Two pre-existing environmental false-positives (not caused by this ticket)

Both `swarmforge/scripts/test/test_lifecycle_script_scope.sh` (BL-637, test
02) and `swarmforge/scripts/test/test_expedite_cli.sh` (BL-567, most cases)
fail when run inside a live swarm session, because their liveness/survivor
checks (`kill_pipeline_swarm.sh`'s closing `pgrep -fl 'handoffd\.bb|...'`, and
`expedite_cli.bb`'s `pids-matching`) scan the WHOLE system process table,
unscoped to the fixture root. A real, already-running `handoffd.bb` (this
very swarm) and the operator's own standing `.swarmforge/operator/babysitterd.sh`
prototype both match and are misread as fixture survivors. Verified this
reproduces identically against the unmodified files (I did not touch either
script) — pre-existing, not a BL-611 regression. Worth its own ticket:
neither test suite can run cleanly on a host with a live swarm/operator.

## Handoff

Forwarding to cleaner. Full test evidence in this parcel's commit message.
