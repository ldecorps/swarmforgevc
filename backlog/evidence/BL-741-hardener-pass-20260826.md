# BL-741 hardener pass — 2026-08-26

## Reviewed commit
- Received: `aa0fa22099` (coder pilot scoped CRAP gate)
- Merged into hardender at merge commit on `swarmforge-hardender`

## Scope
`pilotScopedCrapCheck.ts`, `pilotAcceptanceGate.ts` land-gate wiring,
`hardender.prompt` CRAP/mutation_cost separation, acceptance feature + steps.

## Checks run

1. **Unit**: `node --test extension/test/pilotScopedCrapCheck.test.js
   extension/test/pilotAcceptanceGate.test.js` → 35/35 pass.
2. **Acceptance** (after `npm run compile`):  
   `run_acceptance.sh specs/features/BL-741-bl627-pilot-missed-crap-gate.feature`
   → 5/5 pass.
3. **Gherkin mutation**: inapplicable (plain Scenarios, no Outline).
4. **Stryker** (`pilotScopedCrapCheck.ts`): dry-run blocked by unrelated
   pre-existing CLI subprocess test failure (BRIDGE_TOKEN listen test) — not
   introduced by this parcel. Targeted unit + acceptance cover the gate.
5. **Mutation cooldown**: `pilotScopedCrapCheck.ts` → run; `pilotAcceptanceGate.ts`
   → skip-cooldown.

## required_stages
`[coder, hardener, qa]` — documenter skipped per ticket; forward routes to QA.

## Verdict
Forward to documenter (required_stages routing → QA).
