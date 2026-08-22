# BL-855 hardener pass — 2026-08-08

Reviewed commit received via architect's `e2d5f3ca28` (evidence-only, no
defects), merged into this worktree. This slice is `.bb` daemon tooling only
(`swarmforge/scripts/push_sweep_lib.bb`, `handoffd.bb`, tests) — no Babashka
mutation/CRAP/DRY tooling is wired for `.bb` (engineering.prompt Startup
Tools), so this pass applies the documented degraded posture: verify the
existing suites, and treat the coder/architect's non-vacuity property checks
as this slice's BL-638 hand-authored mutation sweep (they already assert a
specific mutant — an unconditional merge-exemption, and a dirty-working-tree
stand-in — is caught by the predicate's own oracle).

## BL-149 cooldown gate

- `push_sweep_lib.bb`: `run` (file age 9.00d > 3d cooldown; host load quiet at
  time of check).
- `handoffd.bb`: `skip-cooldown` (file age 0.86d, inside the 3-day window —
  it is the shared daemon hub file, touched by this and other in-flight
  tickets; correctly deferred to a later pass once it stops churning).

## Tests run

- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb` — 500 runs,
  ALL PROPERTIES HOLD, including both BL-855 non-vacuity checks (an
  unconditional-merge-exemption mutant and a dirty-working-tree-suppresses-
  the-verdict mutant are each caught by the property's own oracle).
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS
  (unaffected by this ticket; re-run as a regression check since it shares
  `handoffd.bb`).

## CRAP / DRY

Not applicable — no `.ts` files touched by this ticket's own commits (the
push-sweep/no-op-merge slice is entirely `.bb`). CRAP/DRY tooling in this
project is TypeScript-only (`extension/scripts/crapReport.js`, `npm run dry`
scoped to `extension/src`).

## Known pre-existing environmental gap (not a regression)

`bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` still fails
locally with `env: setsid: No such file or directory` — `setsid` predates
this commit in this file and is not installed on this macOS host (no
util-linux). Independently reconfirmed; matches the cleaner's and architect's
own findings on this same ticket. Every `setsid`-based wiring test in this
suite fails identically here; not attempting a host environment change
mid-ticket.

## Orphan check

`pgrep -afl 'node --test|stryker'` — none. `pgrep -afl tmux` — only the live
swarm's own `.swarmforge/tmux/*.sock` session; no leaked fixture sockets.

## Verdict

NONE — no defects found. Forwarding to documenter.
