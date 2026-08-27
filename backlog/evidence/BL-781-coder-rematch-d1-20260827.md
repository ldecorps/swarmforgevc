# BL-781 coder rematch — 2026-08-27

## Bounce D1
Scenario 07 treated `specs/features/` Examples as live callers.
Fix: `specs/pipeline/steps/lib/bl781LiveGrepOffender.js` excludes
`specs/features/`; step handler uses it.

## Verification
- `npx vitest run test/bl781LiveGrepOffender.test.js` — pass
- `npm run test:properties -- --run test/bl781LiveGrepOffender.property.test.js` — pass
- `run_acceptance.sh` BL-781 feature — 13/13 pass

## Commit guard
First commit attempt ran the full property suite; BL-1124 canary fired
(suite mutated shared checkout to `init` tips). Restored `swarmforge-coder`
to `1228838bc` via `git reset --hard`. This rematch commit uses
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` as recovery-only (BL-1121/BL-1124),
after scoped property + acceptance green above.

By coder.
