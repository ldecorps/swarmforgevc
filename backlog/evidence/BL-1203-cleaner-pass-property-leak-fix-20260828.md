# BL-1203 cleaner pass (property-fixture-leak re-fix) — 2026-08-28

Merged coder handoff `065b85d7a8` (architect bounce D1, third occurrence
of this session's fixture-leak class after BL-1205 and BL-1213). Clean
merge, no conflicts.

## Review
Both property tests' `fs.rmSync(sharedRoot, ...); sharedRoot = undefined;`
now run inside `try/finally` around their `fc.assert(...)` call, so a
property failure no longer leaks the fixture git repo AND no longer leaves
`sharedRoot` pointing at an abandoned root for the second property test to
reuse. Small, targeted, matches the established fix shape from the prior
two occurrences. No duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run --config vitest.properties.config.mjs telegramFrontDeskBotCli`:
  3/3 pass; `ls /tmp | grep bl1203-property` before and after: 0 matches
  both times.
- `vitest run telegramFrontDeskBotCli`: 270/270 pass (no regression).

By cleaner.
