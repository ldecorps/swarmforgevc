# BL-479: property-test non-vacuity proof

The ticket's build steps require demonstrating the seeded property test is
non-vacuous: it must genuinely FAIL when the invariant it checks is broken,
then pass again once restored. This is that record.

## Suite under test

`extension/test/benchmarkAggregate.property.test.js`, run via
`npm run test:properties` (vitest.properties.config.mjs), against
`computeMean`/`computeStdDev` in `extension/src/benchmark/aggregate.ts`.

## Break

`computeMean` was temporarily changed from:

```ts
export function computeMean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}
```

to (`+` flipped to `-`):

```ts
export function computeMean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum - v, 0) / values.length : 0;
}
```

## Result with the break in place: 3 of 5 properties FAIL

```
 ❯ test/benchmarkAggregate.property.test.js (5 tests | 3 failed) 42ms
   × property: computeMean of a non-empty array lies within [min, max] of that array 25ms
     → Property failed after 2 tests
Counterexample: [[2.0000000000000005e-9,0]]
   × property: computeStdDev is never negative, for any array including the empty one 7ms
     → Property failed after 1 tests
Counterexample: [[-7.858638923513144e-163]]
   × property: computeStdDev of a constant array is ~0 - no dispersion when every value is identical 5ms
     → Property failed after 1 tests
Counterexample: [7.858638923513144e-163,1]
   ✓ property: computeMean is unaffected by the array's order (permutation invariance) 3ms
   ✓ property: doubling an array (concatenating it with itself) never changes its mean 1ms

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

(The two properties that stayed green - order-invariance and self-duplication
invariance - are properties the broken `sum - v` reduction still happens to
satisfy on its own terms, since negating every term still commutes and still
doubles consistently. The other three genuinely depend on the SIGN of the
summation and catch the break immediately.)

## Restore and re-run: all 5 properties PASS

`computeMean` was restored to its original `sum + v` form (`git diff` on
`aggregate.ts` shows no changes after the restore - confirmed byte-identical
to the pre-break state):

```
 ✓ test/benchmarkAggregate.property.test.js (5 tests) 12ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Re-run 5 additional times with fresh random seeds (fast-check reseeds every
invocation) to build confidence beyond one lucky pass - all green, no flakes.

## Wiring confirmed separate from normal verification

- `npx vitest run --coverage` (the same run `npm run coverage`/`npm run crap`
  use) does not mention `benchmarkAggregate.property.test.js` anywhere in its
  output - the property file is invisible to coverage.
- Stryker's mutation run (`stryker.config.json`) points at the SAME
  `vitest.config.mjs` that now excludes `**/*.property.test.js`, so the
  mutation run inherits the same exclusion.
- `.jscpd.json`'s DRY scan is scoped to `**/*.ts` under `src/` only - the
  property file (`.js`, under `test/`) was never in its scope to begin with.
- The normal unit suite (`npx vitest run`, no `--config` override) still
  reports exactly 317 test files / 5103 tests, unchanged by adding the new
  property file - confirming it is excluded, not merely uncounted.

By coder.
