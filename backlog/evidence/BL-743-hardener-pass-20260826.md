# BL-743 hardener pass — 2026-08-26

## Reviewed commit
- Received: `04d7f03df5` (coder pilot mkdtemp convention gate)
- Merged into hardender on `swarmforge-hardender`

## Scope
`pilotMkdtempConventionCheck.ts`, `pilotAcceptanceGate.ts` wiring,
`hardender.prompt` mkTmpDir convention guidance, acceptance feature + steps.

## Checks run

1. **Unit**: `node --test extension/test/pilotMkdtempConventionCheck.test.js
   extension/test/pilotAcceptanceGate.test.js` → 35/35 pass.
2. **Acceptance** (after `npm run compile`):  
   `run_acceptance.sh specs/features/BL-743-bl627-pilot-missed-mkdtemp-convention.feature`
   → 5/5 pass.
3. **Gherkin mutation**: inapplicable (plain Scenarios).
4. **Mutation cooldown**: new TS files within cooldown window — deferred per gate.

## required_stages
`[coder, hardender, qa]` — documenter skipped; forward routes to QA.

## Verdict
Forward to documenter (required_stages routing → QA).
