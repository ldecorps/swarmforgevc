# BL-1199 hardener pass — 2026-08-28

## Reviewed commit

Merged architect's `571b1fe6d4` (cleaner dedupe `eaa72408c` on coder
`c378125d1`) clean, no conflicts, into hardender.

## Mutation coverage

- `named_tunnel_liveness_lib.bb` / `named_tunnel_liveness_check.bb` /
  `swarm_status.bb` / `swarm_status_lib.bb` — BL-149 cooldown gate: `run`
  (host quiet, load avg ~2.1 on 20 cores). The architect's own review
  already confirmed the shared `liveness-verdict` predicate is covered by a
  200-run seeded property test hitting all 4 `(configured?, pid-alive?)`
  branches plus an explicit non-vacuousness check (`broken-trusts-
  configuration-alone` mutant). Re-ran directly: `ALL PASS` /
  `ALL PROPERTIES HOLD (200 runs)` / `ok`.
- `start_ancillary_services.sh` — BL-149 cooldown gate: `skip-cooldown`
  (touched 1.05 days ago, inside the 3-day window) — no full sweep this
  pass per the office-hours/cooldown discipline. I still hand-mutated its
  one conditional as a targeted probe (see Defect below) since it sits
  directly on the ticket's own explicit constraint.

## Defect found and fixed: NOT_CONFIGURED silently reachable through the DOWN branch

`start_ancillary_services.sh`'s named-tunnel block only checked
`[[ "$NAMED_TUNNEL_RC" == "1" ]]` (DOWN) to decide whether to warn/relaunch
— correct as written. But nothing in the existing test suite exercised the
`NOT_CONFIGURED` (exit 2) path *at that call site*, even though the
ticket's own constraint is explicit: "A root with no named tunnel
configured must report 'not configured', never 'down' — an absent tunnel
is not a fault."

Hand-mutation probe (mutated a throwaway copy's condition from `== "1"` to
`!= "0"`, which folds DOWN and NOT_CONFIGURED into the same branch):
existing `test_named_tunnel_liveness_ancillary_start.sh` still reported
`ALL PASS` — the mutant survived, because no scenario in the file ever ran
against an unconfigured root. Restored the file immediately after
confirming (`git diff` clean before proceeding).

Fixed by adding a third scenario to
`swarmforge/scripts/test/test_named_tunnel_liveness_ancillary_start.sh`:
unconfigured root (no `named-tunnel.env`, no pidfile) must produce no
"bubble named tunnel" warning and no relaunch attempt. Verified: passes
against the real script; re-applying the same mutant now fails it
(`FAIL: regression: an unconfigured root must never be flagged as down`) —
confirms the new assertion is load-bearing, not vacuous. Source restored
clean before committing.

## Gherkin acceptance mutation (BL-113, soft)

`Scenario Outline: Swarm status reports the editor tunnel and the named
tunnel as separate rows` mutated 4/4 examples-cell values; all 4 killed
(unmatched-step crash on the mutated literal — legitimate kill via the
step-matching mechanism, not a probe artifact). Manifest embedded in the
feature file (`acceptance-mutation-manifest-begin/end`,
`scenarios[0].result = {Total:4, Killed:4, Survived:0, Errors:0}`). No
`Examples:` rows in scenario 01 (plain `Scenario:`) — nothing to mutate
there, consistent with BL-113's own scope.

Cleaned up the mutation work dir (`./tmp/bl1199-gherkin-mutation`) and
confirmed no `/tmp/bl1199-*` fixture dirs survive after the run.

## Full verification (re-run after the fix)

- `bb .../named_tunnel_liveness_lib_test_runner.bb` — ALL PASS
- `bb .../named_tunnel_liveness_lib_property_runner.bb` — ALL PROPERTIES HOLD (200 runs)
- `bb .../swarm_status_lib_test_runner.bb` — ok
- `bash .../test_named_tunnel_liveness_ancillary_start.sh` — ALL PASS (3 scenarios now, was 2)
- `bash .../test_swarm_status_bubble_tunnel_row.sh` — ALL PASS (4 cases, unchanged)
- `node specs/pipeline/cli.js specs/features/BL-1199-...feature` — 3/3 pass

No `extension/` files touched by this ticket — CRAP/DRY (jscpd, scoped to
`extension/src`) do not apply. No orphaned `node --test`/stryker/tmux
processes before or after this pass.

## Whole-tree guards (touched `specs/pipeline/steps/index.js` + new step file)

Ran all 13 `*Guard*.test.js` (excluding `.property.` siblings) per the
standing rule. 4 pre-existing failures, all in files this ticket never
touched and unrelated to BL-1199's own changes:

- `socketFixtureShortRootGuard.test.js` — `bl1112StandingUnitRedsSteps.js`,
  `bl691AmbulanceWorkflowGapsSteps.js` (long `os.tmpdir()` socket root).
- `tempDirTrapGuard.test.js` — `local_coder_battery.sh` and ~10 pre-existing
  `.bb` property/test runners under `swarmforge/scripts/test/` with no
  shutdown hook.
- `tmpDirMigrationGuard.test.js` — ~28 pre-existing raw `mkdtempSync` call
  sites across `extension/test/`.
- `liveRepoDerivationGuard.test.js` — `docsStructureRealTree.test.js`,
  `pilotMkdtempConventionCheck.test.js`.

None name `bl1199PackSwitchBubbleTunnelSteps.js`,
`named_tunnel_liveness_*.bb`, `swarm_status.bb`, or `swarm_status_lib.bb` —
this parcel's own new/changed files are clean against every guard. Per the
BL-1063 discipline ("a red outside your parcel is already ticketed until
grepped and proved otherwise"), these are pre-existing, unowned repo-wide
debt this ticket did not introduce and is not the place to fix.

## Disposition

Hardened. One real gap found and closed (NOT_CONFIGURED-at-ancillary-start
untested), directly on the ticket's own explicit constraint. Everything
else the architect verified re-confirmed green. Forwarding to documenter.
