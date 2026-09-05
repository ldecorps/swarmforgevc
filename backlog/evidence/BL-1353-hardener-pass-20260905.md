# BL-1353 hardener pass — clean sweep, forwarding

## Merged
Merged architect's `f28ebd7c06` (clean sweep) into this worktree, ancestry
confirmed (`git merge-base --is-ancestor f28ebd7c06 HEAD`). Pure Babashka
logic + doc + one acceptance step file — no TypeScript touched, so no
dependency-gate/Stryker/CRAP/jscpd surface applies here (confirmed against
`.jscpd.json`'s `**/*.ts` scope and the diff itself).

## Re-verified
- `bb swarmforge/scripts/test/operator_lib_test_runner.bb` — ALL TESTS
  PASSED (includes the 4 BL-1353 assertions added by the coder: no wake
  on fresh-inbox-alone, real sources untouched, both `should-relaunch?`
  directions).
- `bb swarmforge/scripts/test/operator_lib_bl653_property_runner.bb` — ALL
  PASSED (forbidden set now includes `TASK_ARRIVED`, checked against all 8
  tick states in both directions: never re-enters, and whatever the tick
  does raise is in the manufactured set).
- `test_operator_runtime_tick.sh` — ALL CHECKS PASSED.
- `test_operator_runtime_bl653_escalation_driven.sh` — ALL CHECKS PASSED
  (`BABYSITTER_ESCALATION` and `SWARM_CONTROL_LOST` still launch).
- Acceptance (`BL-1353-...feature`): **4/4** pass.
- Property (`bl1353TaskArrivedIsNotAnEscalation.property.test.js`, via
  `npm run test:properties`\-equivalent config): **3/3** pass. Already
  exhaustive on both declared invariants — full 8-state truth table with
  exact `deepEqual` expected wake lists (invariant 1) and full 8-state
  truth table on `should-relaunch?` with an explicit discriminating pair
  (fresh-mail vs. no-fresh-mail, both other inputs held constant, invariant
  2) — not a sampled or partial sweep.

## Hand-mutation spot check (BL-638 fallback — no Stryker/mutation tool
wired for `.bb`)
Reverted the retirement in `operator_lib.bb` by hand (re-added the
`coordinator-inbox-fresh?` destructure/conj to `tick-observed-events`,
without touching `manufactured-tick-event-types`) and re-ran
`operator_lib_test_runner.bb`: **2 failures**, exactly on the two new
BL-1353 assertions ("fresh coordinator mail manufactures no wake at all"
and "the real wake sources are untouched by the retirement"), both
reporting the reintroduced `TASK_ARRIVED` event. Restored the file
(`git diff` empty afterward, confirmed clean).

Did not separately hand-mutate `should-relaunch?`: it is untouched by
this ticket's diff (BL-310, pre-existing) and is already exercised by an
exhaustive 8-state truth table plus an explicit discriminating pair in the
property test — no gap to close in code this ticket did not write.

## required_wiring
Both anchors confirmed live: `docs/how-to/BL-653-operator-escalation-driven-wake-model.md`
names `TASK_ARRIVED` twice (residual-check list and the "What retired"
list); `bl1353TaskArrivedIsNotAnEscalationSteps.js` exports `registerSteps`
and all 4 scenarios execute (confirmed by the acceptance run above).

## Cleanup
No orphaned `node --test`/`stryker` processes before or after (none were
started — no TS test lane runs for this parcel). Hand-mutation restore
left the tree clean (`git status --short` empty before commit).

## Forwarding
To documenter, priority `00`, same task name, this commit forwarded.
