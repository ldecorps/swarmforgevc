# BL-789 architect bounce (follow-up) — 2026-08-10

Reviewed commit: ac7174a19c (coder, "BL-789: wire new detached-daemon spawns
through fixtureReaper (bounce fix)"), received via cleaner merge ac7174a19c
(task `BL-789-mac-host-switch-freshness-bridge-adopt-fixtureReaper-bounce`).
This is the fix for the D1 bounce recorded in
`BL-789-mac-host-switch-freshness-bridge-adopt-bounce-20260810.md`.

## Verified clean (no defect)

- Dependency-gate (BL-259 hard gate): PASSED, no forbidden edges (run from
  `extension/` against both changed files).
- Co-change report: only expected sibling coupling (steps file <-> property
  test file <-> its docs/how-tos/config siblings), all below the suspected-
  coupling threshold — nothing new.
- The three sites named in the original D1 evidence are correctly fixed:
  - Scenario 04/05's own `spawnDetached()` fixtures (`ctx.preExistingBridgePid`,
    `ctx.unrelatedPid`) now register `onAbnormalExit(() => killPid(...))` the
    moment each has a pid.
  - Scenario 06's real `handoffd.bb` spawn (`ctx.hdPid`) now registers an
    abnormal-exit callback that writes the same `.swarmforge/daemon/stop`
    marker its happy-path terminal step already uses, then kills the pid —
    verified against the happy-path step at line ~560 to confirm it's the
    same convention, not a diverging one.
  - The property test's `handoffd.bb` spawn (invariant 3) drops
    `detached`/`unref()` instead (no fixtureReaper equivalent exists under
    `extension/test/`) — this was one of the two remediations I offered in
    the original bounce, so I'm not relitigating the choice.
- Re-ran `npm run test:properties -- bl789` (from `extension/`): 3/3 pass,
  including invariant 3 with the now-non-detached spawn. No orphan
  `handoffd.bb` process or stale `bl789-*` tmp dir left behind afterward
  (checked via `ps aux` / `find /var/folders -iname 'bl789*'`).
- Re-ran the full acceptance feature
  (`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-789-...feature`):
  7/7 scenarios pass. No orphan bl789 fixture process or tmp dir left behind
  afterward — the only bridge/handoffd processes found post-run were this
  host's own live production daemon/bridge (main worktree paths, default
  port 8765), not test fixtures.
- The 3 declared invariants are unaffected by this commit (it only touches
  test-fixture spawn/cleanup mechanics, no production code), and all 3 still
  pass per the re-run above.

## D1 — the supervisor's OWN freshly-spawned bridge process (scenario 05) is
still uncovered by fixtureReaper; same failure class as the original bounce,
a sibling site the fix didn't reach (class: behavior, blame: coder)

Scenario 05 ("A non-bridge listener on our port is cleared before
spawning") drives the REAL `front_desk_supervisor.bb --check-once` via
`spawnSync` (steps file, "the supervisor takes its next turn" step, line
~379). When the port is held by the `ctx.unrelatedPid` fixture, the real
supervisor kills it and spawns a brand-new, independently-detached bridge
process — confirmed by the assertion at line ~438 that
`ctx.postTickStatus.bridge.pid` must be a **different**, freshly-spawned pid
from `ctx.unrelatedPid`. Because `spawnSync` blocks until the supervisor
process itself exits, and the scenario later asserts the new bridge is
still running, that new bridge process is by construction detached and
outlives its parent (`front_desk_supervisor.bb`) — the exact process shape
BL-458's fixtureReaper was built for.

This commit's fix registered `onAbnormalExit` callbacks for the THREE sites
the JS test file spawns *directly* (`ctx.preExistingBridgePid`,
`ctx.unrelatedPid`, `ctx.hdPid`) — but the supervisor's own freshly-spawned
bridge (`ctx.postTickStatus.bridge.pid`) is a fourth, distinct process and
is registered nowhere: not via `onAbnormalExit`, and not via `track()`
either. Its only cleanup is the scenario's own happy-path terminal step
("a bridge process is spawned", `killPid(ctx.postTickStatus.bridge.pid)`,
line ~441). If the run is interrupted/killed/timed out — or an earlier
assertion throws — between the tick completing and that terminal step
running, this bridge process leaks exactly like the original D1 orphan did.

This is not a hypothetical gap needing a bespoke callback: `reap()` in
`specs/pipeline/steps/lib/fixtureReaper.js` already reads
`<root>/.swarmforge/operator/front-desk-supervisor.status.json` and kills
`status.bridge.pid` directly — which is the EXACT file
(`path.join(ctx.bridgeRoot, '.swarmforge', 'operator',
'front-desk-supervisor.status.json')`, steps file line ~383-384) and field
this new bridge pid is written to. `track(ctx.bridgeRoot)` is the
established pattern for this precise shape — `frontDeskHeadlessLauncherSteps.js`
(the file this commit's own message cites as "same pattern as") calls
`track(ctx.root)` for exactly this reason, right after the fixture root is
established. No `track(` call exists anywhere in
`bl789MacHostSwitchFreshnessBridgeAdoptSteps.js` (confirmed by grep) — the
one site where the cited pattern actually applies is the one site it wasn't
used.

**Remediation**: call `track(ctx.bridgeRoot)` (import `track` alongside the
already-imported `onAbnormalExit` from `./lib/fixtureReaper`) once
`ctx.bridgeRoot` is established for scenario 05 — the same point scenario
04/05's own `mkTmp('bl789-bridge-')` step runs, or immediately before "the
supervisor takes its next turn" spawns the real supervisor. This covers the
supervisor's own bridge spawn via the existing status.json-reading `reap()`
path with no bespoke callback needed, and is idempotent alongside the
scenario's own happy-path `killPid` calls (`reap()` reads the pid fresh from
the status file at signal/exit time, so it works whether the file exists or
not, and killing an already-dead pid is a no-op).
