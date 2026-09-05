# BL-1287 — architect pass (redo after bounce), 2026-09-05

Ticket: BL-1287-a-fixture-sweep-must-not-signal-a-live-runs-fixtures
Role: architect
Commit reviewed: 88506bfc32 (cleaner, redo after my bounce)

## Result: NONE — the bounced finding is resolved; no other defect found

## What changed since my bounce

My earlier bounce (`backlog/evidence/BL-1287-bounce-20260905.md`) found
`isProcessAlive` misreporting a genuine zombie creator as alive (bare
`process.kill(pid, 0)`), which let a fixture whose creator had just been
SIGKILLed but not yet reaped go unswept — violating invariant 2. The
coder's redo fixes this with a process-state check
(`ps -o stat= -p <pid>`, treating a leading `Z` as gone) layered after the
existing `kill(pid, 0)` probe, plus a `pid <= 0`/non-integer guard up
front. This is a different (more portable) technique than BL-1292's own
identity-check fix, chosen deliberately because there is no command-line
text to match identity against here — only a bare creator pid — and
`ps -o stat=` works on both this repo's supported OSes, unlike a
`/proc`-only check.

## Independently reproduced the fix, using my own bounce's exact repro

Re-ran the same zombie-construction probe script I used to find the
original defect (`spawnZombie` + a fixture naming that zombie's pid as
creator) against the fixed code:

```
zombie confirmedZombie: true pid: 26582
isProcessAlive(zombiePid): false
fixturePid: 26617 selected (should be swept since creator is functionally dead): true
```

Correct now — the zombie creator is reported gone and its fixture is
swept.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `fixtureTunnelName.js`, reverted the zombie-state check to a
bare `return true;` (post-`kill(pid,0)`-probe), reran
`test/helpers/fixtureTunnelName.test.js`: failed immediately —
`isProcessAlive answers false for a zombie process ... true !== false`.
Restored the file and confirmed byte-identical via `diff` and
`git status --short` (empty).

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.` Test-harness code only (a helper, its unit test, a
  property test, a new shared fixture-writer helper, the step handler) —
  no production module touched, no webview, no VS Code API, no secrets,
  no browser storage.
- **Co-change report**: flags are all this exact ticket's own file family
  co-changing across its two implementation rounds (expected, informational
  only) — nothing pre-existing disturbed.
- **jscpd** (independently re-run on the four touched/new files, not just
  trusted from the cleaner's evidence): `0 clones` — confirms the
  cleaner's own DRY fix (extracting `bl1287FixtureSweepFixture.js`) holds.
- **mutation-site-count** on `fixtureTunnelName.js`: 101, one over the
  100 advisory threshold (BL-485) — independently confirmed. Agree with
  the cleaner's no-split judgment: this is one cohesive concern (tunnel-name
  shape + leak-detection selection), and splitting on an arbitrary line
  count would not improve separation of concerns.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family — correctly, since this is a genuine fix, not a
  standing-red waiver.

## Invariants Review (BL-633/654) — re-verified live

1. **Invariant 1** ("a live run's fixture is never selected") —
   `bl1287FixtureSweepScopingInvariants.property.test.js`'s invariant-1
   property: pass.
2. **Invariant 2** ("the sweep still clears every fixture left by a run
   that is gone, however that run died") — now drives THREE death modes
   (`SIGKILL`, `SIGTERM`, `ZOMBIE` — the bounce's own case): pass, and I
   independently confirmed non-vacuity above rather than trusting the
   coder's own claim.
3. **Invariant 3** ("no selection path can reach a cloudflared outside the
   OS temp directory") — unchanged from the original pass, still holds
   (property test pass, confirmed in my own run below).

## Independently re-verified the substance

- `npx vitest run test/helpers/fixtureTunnelName.test.js` — **7/7 pass**
  (6 original + the new zombie case).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1287FixtureSweepScopingInvariants.property.test.js
  test/bl1061TunnelFixtureIsolation.property.test.js
  test/bl857TunnelOwnershipInvariants.property.test.js` — **12/12 pass**
  (BL-1287's own 3, BL-1061's regression-fixed 5, BL-857's sibling suite's
  4 including its own BL-1292 property — confirms no cross-file
  regression from BL-1287's creator-liveness change).

## Acceptance wiring — driven end-to-end myself

`node specs/pipeline/cli.js
specs/features/BL-1287-a-fixture-sweep-must-not-signal-a-live-runs-fixtures.feature`
— **4/4 scenario runs, run twice consecutively, both green**.
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371, confirmed by the runtime not throwing).

## Scope note on the acceptance feature itself

The coder's evidence notes the zombie case was added only to the property
test, not as a new Scenario Outline row in the feature file, on the
grounds that Gherkin authorship is out of coder's domain. Agree this is a
reasonable call for THIS pass — the property test is the mechanism my
bounce's own evidence pointed at, invariant 2 is now genuinely covered
end-to-end, and the acceptance feature's existing scenario 01 already
covers the "creator gone" row generically (not tied to a specific death
signal). Not a blocking gap.

## Verdict

Architecturally compliant. The bounced finding (zombie-creator
misreported as alive) is resolved and independently confirmed via direct
reproduction and non-vacuity check; no other architecture violation,
invariant violation, or correctness defect found. Forwarding to hardener.
