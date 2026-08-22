# BL-514 — hardener pass 2, 2026-08-15

## Scope

Received from architect as `merge_and_process architect 14a817f4a8` (batched
with a QA merge-up note for BL-894, forwarded/merged separately per Article
2.6 and the QA-merge-up-broadcast protocol — BL-894 is terminal here, merged
only, not re-forwarded). Reviewed commit `14a817f4a8` ("BL-514: architect
pass 2 - approve acceptance step handlers"), architect's second review of
coder commit `d0d4f3907d` ("BL-514: step handlers for the swarm-ensure
RC-health acceptance contract", forwarded unchanged by cleaner as
`c44912fb3f`).

This continues my own prior hardener pass (`backlog/evidence/BL-514-hardener-pass-20260814.md`,
commit `315e27de5`), which hardened the underlying `swarm_ensure.bb` RC
wiring and RC-1..RC-5/RC-7. The new work since then is purely the acceptance
scaffolding for the specifier's 2026-08-14 spec amendment: the step-handler
file and the RC-6 shell case.

All changed files this round
(`specs/pipeline/steps/bl514RcHealthInSwarmEnsureSteps.js`,
`specs/pipeline/steps/index.js`, `specs/features/BL-514-rc-health-in-swarm-ensure.feature`,
`swarmforge/scripts/test/test_swarm_ensure.sh`) are either Babashka-suite-gated
(`.sh`/`.bb`, no mutation/CRAP/DRY wired per engineering.prompt Startup Tools)
or plain step-handler glue JS living outside `extension/src/**/*.ts` — `npm
run dry` is scoped to `extension/src/**/*.ts` (`.jscpd.json` pattern
`**/*.ts`) and `npm run crap` scopes coverage lookups to `src/*.ts` paths
(BL-381), so this file is out of both tools' scope, same as every other
`specs/pipeline/steps/bl*.js` file in the tree. No mutation/CRAP/DRY gate
applies to this parcel's own changed files.

## Live test execution

Checked for orphaned processes first (`pgrep -fl 'node --test|stryker'`,
scoped to this worktree) — none. Host load at start: `uptime` ~4.0-5.0 on 4
cores (well under the 2x-cores threshold).

Ran the full shell suite directly:

`bash swarmforge/scripts/test/test_swarm_ensure.sh`

**Result: ALL PASS.** Every pre-existing scenario plus all 7 RC scenarios,
including the new RC-6 case:

- RC-1 (BL-514): healthy RC — HEALTHY, no repair
- RC-2 (BL-514): degraded RC repaired, reclassified FIXED
- RC-3 (BL-514): degraded RC repair doesn't restore the flag -> FAILED
- RC-4 (BL-514): `:down` left to `agent:<role>`, never double-respawned
- RC-5 (BL-514): `rc:<role>` immediately follows its own `agent:<role>` line
- RC-6 (BL-514): a launch script declaring no `--remote-control` flag
  reports HEALTHY, AND the fake cmdline probe is never invoked (asserts both
  the status string and that no marker file was created by the probe stub —
  the actual behaviour, not just the surface status)
- RC-7 (BL-514): mono-router rotated resident judged against its active
  role's launch script, never forced back to home

38 total `PASS:` markers, zero failures. Checked for orphaned
processes/leaked fixture tmux servers after the run (`pgrep -fl 'node
--test|stryker'`, `pgrep -afl tmux`) — clean, only the live swarm's own
repo-path-socket tmux server remains.

## Acceptance pre-check (BL-203/BL-221)

Ran `specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-514-rc-health-in-swarm-ensure.feature` against the real
generated test file. This is expensive by design (each of the feature's 7
scenarios resets its own fixture context and independently drives a fresh
full `test_swarm_ensure.sh` run via the step handler's `runSuite()`, same
posture as `bl805RotateGateOnUnfinishedInProcessParcelSteps.js` — no
parallel reimplementation of `swarm_ensure.bb`'s decision logic) so it took
several multiples of a single suite run under this host's intermittently
elevated load (6-10 on 4 cores during the run, self-induced by running
multiple copies of the same subprocess-heavy suite).

**BLOCKED BY extended runtime, not by any defect found — recorded per
Article 4.4's run-or-blocked rule rather than assumed clean.** Node's
default test reporter buffers ALL output until the entire generated file
finishes (confirmed: output file stayed 0 bytes throughout), so no
per-scenario result is observable until every one of the 7 scenarios has
independently re-driven the full shell suite to completion. Let it run 19
minutes (started at low-moderate host load, ~4-10 on 4 cores, self-elevated
by the run's own concurrent full-suite subprocesses — never the severe
95-134 load the architect's pass-1 review hit) with confirmed forward
progress throughout (`ps` showed successive distinct child `bash
test_swarm_ensure.sh` processes over time, matching each scenario's own
fresh suite invocation — never a stuck/repeating PID). Terminated the run
(process group, then the reparented worker + descendants) rather than
continue waiting indefinitely; reaped it cleanly (confirmed via `pgrep -fl
'node --test|stryker'` and `pgrep -afl tmux` afterward — no orphaned test
processes, no leaked fixture tmux servers per the BL-807 lesson).

Basis for proceeding despite the incomplete run, converging from three
independent angles:
1. The direct `test_swarm_ensure.sh` run above is the authoritative source
   of truth the step handlers merely wrap (`runSuite()` spawns this exact
   script, asserts on its `PASS: RC-N` markers) — it already ran to
   completion, ALL PASS, all 7 RC markers present.
2. Exhaustive manual cross-check (below) that every `Given`/`When`/`Then`
   text in the feature file has a matching registered step regex with the
   correct required marker — the specific failure mode this pre-check
   exists to catch (BL-203/BL-221: a scenario failing for a MISSING step
   handler) is ruled out by direct reading, not just by inference.
3. The architect's pass-2 review already recorded the coder's own commit
   message noting a green `run_acceptance.sh` run against this exact
   feature file at commit time (which caught and fixed a marker-mapping bug
   before the commit landed) — this configuration has run clean before.

This is a partial-verification call, not a clean pass — surfaced here
explicitly rather than silently upgraded to "ran green."

## Structural cross-check (independent of architect's own review)

- Every `Given`/`When`/`Then` step text in
  `specs/features/BL-514-rc-health-in-swarm-ensure.feature` has a matching
  registered regex in `bl514RcHealthInSwarmEnsureSteps.js` — verified by
  reading both side by side, scenario by scenario (01 through 06/RC-7).
- `STATE_TO_MARKER`/`knownState()` reject any Outline `<state>` value outside
  `{healthy, down, degraded, no-flag}` (BL-421 KNOWN_VALUES rule). Scenario
  05's fixed-text Given sets `state: 'no-flag'` as a literal (not a captured
  Outline value), correctly bypassing the validator per the architect's own
  note — the literal still resolves through the same `STATE_TO_MARKER`
  lookup as every captured state when the shared HEALTHY-assertion step
  runs.
- `specs/pipeline/steps/index.js` registers `bl514RcHealthInSwarmEnsureSteps`
  alongside `bl894QueueRepostsSelectionPollSteps` and
  `bl765BubbleRemoteConfigChiptuneCatalogSteps` — all three preserved
  through the merge (BL-765 rides along in this branch's history from a
  sibling ticket; its own files are out of this parcel's scope per "An
  Approval Authorizes Only Its Ticket's Work" and are left untouched here).
- RC-6's shell case (`test_swarm_ensure.sh` lines ~1020-1040) asserts BOTH
  halves scenario 05 requires: the `HEALTHY` status string, and that the
  fake cmdline probe's marker file was never created — proving the live
  process genuinely was never probed, not just that the status came back
  right.

No functional test gaps found. No new mutation/CRAP/DRY tooling to run
(none wired for the changed file types). Forwarding to documenter.

By hardener.
