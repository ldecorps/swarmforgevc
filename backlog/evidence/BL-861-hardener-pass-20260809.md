# BL-861 hardener pass — 2026-08-09

Reviewed the commit received via architect's `1b05b46f81` (merged into this
worktree, no defects noted by architect), coder-authored `5450a496`. Scope:
`extension/src/metrics/siblingDeferralStatus.ts` (new), `extension/src/quality/
siblingDeferral.ts` (`checkReadsBlockerActivePath` addition), `extension/src/
tools/qa-sibling-check.ts` (`defer` refusal + `list` subcommand), and the
acceptance feature/step handlers.

## BL-149 cooldown gate

- `siblingDeferralStatus.ts`: `run` (new file).
- `siblingDeferral.ts`: `run` (file age 16.4d > 3d cooldown).
- `qa-sibling-check.ts`: `run` (file age 12.8d > 3d cooldown).
- `specs/pipeline/steps/index.js`: `skip-cooldown` (0.1d — wiring-only touch,
  correctly deferred).
- `bl861DeferralSurvivesBlockerClosingSteps.js`: `run` (new file).

## Tests run

- `npx vitest run siblingDeferral siblingDeferralStatus qaSiblingCheckCli` —
  4 files, 116 tests, all pass.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-861-deferral-
  survives-blocker-closing.feature` — 7/7 scenarios pass.
- `specs/pipeline/scripts/run_gherkin_mutation.sh ... soft` (Scenario Outline
  06 is the only mutable one) — 4/4 mutants killed, 0 survived. Manifest
  embedded in the feature file (previously absent — this is this pass's own
  contribution, not a re-stamp).
- `npm run test:properties` (architect-owned, run here per verification):
  the two BL-861 property tests (`bl861DeferralLifecycleInvariants.property.
  test.js`) pass in isolation and inside the full run. The full run also
  surfaced an UNRELATED pre-existing failure in `bl787NamedTunnelInvariants.
  property.test.js` (BL-787, landed before this ticket) — root-caused to that
  test spreading real `process.env` into its fixture subprocess without
  stripping `SWARMFORGE_NAMED_TUNNEL`/`SWARMFORGE_NAMED_TUNNEL_HOSTNAME`,
  which this operator host has genuinely exported for the live resident-spy
  tunnel; the "identity absent" case is contaminated by the real ambient
  config on this host only. Not a BL-861 regression (predates this ticket,
  doesn't touch tunnel code) — reported by note to specifier/coordinator for
  ticketing, not fixed here (out of this ticket's scope, Test Speed and
  Isolation's own env-stripping rule applies to a different ticket's fixture).

## CRAP

`node scripts/crapReport.js src/metrics/siblingDeferralStatus.ts src/quality/
siblingDeferral.ts src/tools/qa-sibling-check.ts` — 100% coverage on every
function; max CRAP 6.00 (`openBlockersForTicket`, `hasValidDeferFields`), at
the <= 6 threshold, nothing over.

## DRY

`npm run dry` — 36 pre-existing clones repo-wide, none touching this ticket's
3 changed files. No new duplication introduced.

## Mutation (Stryker)

BLOCKED BY HOST LOAD, not skipped as clean. `bb swarmforge/scripts/
mutation_cooldown_gate.bb` read `busy` before and after the attempt
(load_avg 9-13 on 4 cores, threshold 8). One scoped differential attempt
(`--mutate out/metrics/siblingDeferralStatus.js,out/quality/siblingDeferral.js,
out/tools/qa-sibling-check.js --concurrency 2`, 406 mutants instrumented) hit
the documented load-crash signature exactly: `Initial test run timed out!`
after ~5 minutes wall clock, matching the "Stryker dry-run times out even at
concurrency=1 under severe load" lesson. Per the office-hours mutation bypass
(constitution Engineering Rules), this parcel is forwarded now on the strength
of its targeted-test hardening (100% coverage, 94 targeted unit tests, two
hand-verified-non-vacuous property tests, 7/7 acceptance scenarios, 4/4
Gherkin mutants killed) rather than stalling for a quiet window. Stryker
should be re-run on these 3 files on the next quiet pass.

## Orphan check

`pgrep -afl 'node --test|stryker'` — none after the Stryker crash exited
cleanly. `pgrep -afl tmux` — only the live swarm's own
`.swarmforge/tmux/*.sock` session; no leaked fixture sockets.

## Verdict

No defects in BL-861 itself. Forwarding to documenter. Stryker mutation
deferred to a quiet pass (recorded above, not silently skipped). One
unrelated pre-existing defect (BL-787 property-test env leak) reported
separately by note, not folded into this ticket.
