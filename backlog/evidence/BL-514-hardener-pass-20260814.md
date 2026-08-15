# BL-514 — hardener pass, 2026-08-14

## Scope

Received from architect as `merge_and_process architect e7a0fdcbe2` (batched
with BL-894, same commit, forwarded separately per Article 2.6). Reviewed
commit `e7a0fdcbe` ("Architect pass: approve BL-514 wiring and BL-894 D1
fix"), on top of coder commit `b09ce9b953` ("BL-514: wire remote-control
health check into ./swarm ensure").

All changed files (`swarmforge/scripts/swarm_ensure.bb`,
`swarmforge/scripts/test/test_swarm_ensure.sh`) are Babashka — no
mutation/CRAP/DRY tooling wired for `.bb` (engineering.prompt Startup
Tools). Gated only by the file's own shell unit-test suite, per policy.

## Live test execution — architect recorded BLOCKED BY host load twice;
## re-run here, now green

The architect's review documented two independent `test_swarm_ensure.sh`
attempts stalling at different points under sustained load averages
95-134 on 4 cores, and correctly recorded this as blocked-by-load rather
than a code defect (non-deterministic stall location is the resource-
contention signature per the BL-108/BL-129/BL-139 lesson).

Re-attempted here. Checked orphaned processes first
(`pgrep -fl 'node --test|stryker'`) — none. Ran the full suite in the
background (host load was still elevated, ~23-56 at start):

`bash swarmforge/scripts/test/test_swarm_ensure.sh`

**Result: ALL PASS.** Every pre-existing scenario (01-10, 07a-07f, 05a-05i,
mono-router dormant/illicit-session cases) plus all 6 new RC scenarios:

- RC-1: healthy RC (flag present) — HEALTHY, no repair — PASS
- RC-2: degraded RC repaired, reclassified HEALTHY -> FIXED — PASS
- RC-3: degraded RC whose repair doesn't restore the flag -> FAILED — PASS
- RC-4: `:down` (no live process) left entirely to `agent:<role>`, never
  double-respawned by RC — PASS
- RC-5: `rc:<role>` reported immediately after its own `agent:<role>` line
  — PASS
- RC-7: mono-router resident rotated onto a different role's launch script
  is checked against its ACTIVE launch script, never forced back to home —
  PASS

(RC-6 is a numbering gap in the test file, not a coverage gap — confirmed
by the architect's own review and independently by reading the file: no
scenario was dropped, RC-1..RC-5 and RC-7 cover healthy / degraded->fixed /
degraded-repair-fails->failed / down-no-action / report-ordering /
mono-router-rotation, which is the full branch set of `ensure-rc-role!`.)

Checked for orphaned processes and leaked fixture tmux servers after the
run (`pgrep -fl 'node --test|stryker'`, `pgrep -afl tmux`) — clean; only
the two live-swarm tmux servers (repo-path sockets) remain.

## Structural read (independent of the architect's own, same conclusions)

- `ensure-rc-role!`'s branch logic matches the ticket's acceptance
  criteria exactly: `:healthy`/`:off` -> HEALTHY no-op (verified: the
  `nil? expected-rc-name` short-circuit skips the probe entirely before
  even reaching `rc-status`, avoiding the real process-tree probe on every
  role that has no `--remote-control` flag configured — the large majority
  of the pre-existing suite exercises this path implicitly, and none of it
  hung, confirming the short-circuit works).
- `:degraded` -> repair via `ensure-component!`/`respawn-rc-pane!`,
  reclassified FIXED/FAILED — RC-2/RC-3 exercise both outcomes of the
  re-check-after-repair.
- `:down` -> HEALTHY no-op, left to `agent:<role>` — RC-4 confirms no
  double-respawn.
- `rc-launch-role` resolves against the mono-router resident's ACTIVE
  launch script (not its home role) — RC-7 is exactly the "probe a
  selector with 2+ concurrent candidates" shape from this role's own
  accumulated lesson (here: home role vs. rotated role), and it passes.
- The `mapcat` flattening correctly folds each row's `agent`+`rc` result
  pair into `results`, so an `rc` FAILED yields a non-zero exit exactly
  like any other component (test 04 / RC-3 confirm this via exit code).

No functional test gaps found. No new mutation/CRAP/DRY tooling to run
(`.bb`, none wired). Forwarding to documenter.

By hardener.
