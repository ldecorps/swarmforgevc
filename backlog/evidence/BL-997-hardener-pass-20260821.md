# BL-997 hardener pass, 2026-08-21

Resumed on coordinator note: "BL-997 unparked - BL-1003 landed, resume
hardening and confirm green". Prior turn parked this parcel red (BL-1003 had
not yet ported the TypeScript busy definition, so the agreement gate
genuinely disagreed on `idle-prompt-quoting-the-marker.txt`).

## Merge

Merged `main` (17 commits, coordinator bookkeeping + BL-1007/BL-1008 specs +
`full-forge.conf` seat removal - no code overlapping this parcel's files).
Clean, no conflicts. Confirmed BL-1003 is closed on `main`
(`d5f636b27 Close BL-1003: move to done`) and its port is an ancestor of this
worktree's HEAD.

## Verification (all green)

- `npm run compile` (extension) - fresh `out/` after the merge.
- `bl997BusyMarkerAgreement.test.js` (vitest, not `node --test` - this repo's
  runner is Vitest): 4/4 pass, including the fixture that was previously red
  (`an idle prompt quoting the marker`).
- `bl997BusyMarkerAgreement.property.test.js` (properties config): 1/1 pass.
- `tmuxClient.test.js -t "BL-997"`: pass (respawn precheck refuses the shared
  `live-turn-status-frame.txt` fixture).
- `run_acceptance.sh` on the feature: 5/5 scenarios pass.
- Full `agentPaneState.test.js` + `tmuxClient.test.js`: 89/89 pass, no
  regression in pane-state or respawn paths.
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/` and
  `extension/test/`): all 11 `test/*Guard*.test.js` files, 81/81 tests pass.

## Mutation (BL-113, Gherkin, soft)

`run_gherkin_mutation.sh specs/features/BL-997-....feature . specs/pipeline/steps/index.js soft`

Only `both-sides-agree-01` has an `Examples:` table (3 rows); the other two
scenarios are plain `Scenario:` with nothing to mutate. Result: 3/3 killed, 0
survived, 0 errors, `outcome: pass`. Manifest stamped into the feature file.
Load was severe during this pass (uptime 43/33/29 on 4 cores) but the run
completed in ~47s with no stall signature (status line went straight from
`completed=0` to `completed=3`), so no deferral was needed.

No CRAP/DRY check: this ticket touches no `extension/src/*.ts` file (only
test files, fixtures, and `specs/pipeline/steps/`), so neither tool's scope
applies. `specs/pipeline/steps/lib/bl997AgreementCheck.js` (the one
production-logic file, 4 lines of real logic) is outside Stryker's
`out/**/*.js` mutate scope by design - its mutation coverage is the Gherkin
run above, which exercises it via the real acceptance path.

Scratch artifacts (`./mutations/`, `./base/`) removed after the run; no
orphaned test/mutation processes left running (`pgrep` confirmed clean).

## Outcome

Green on every gate this parcel owns. No code changes needed - BL-1003's
landing was the fix; this pass exists to prove it forward to a
mutation-verified gate. Forwarding to documenter.
