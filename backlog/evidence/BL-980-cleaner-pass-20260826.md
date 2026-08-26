# BL-980 — cleaner pass — 20260826

- merge_and_process coder tip `c15f9eee89` (clean merge, 6 paths).
- Verified: `vitest run test/bl980RecentlyClosedElapsed.test.js` — 7/7 PASS.
- Slice: `pipelineBoard.ts` (formatRecentlyClosedAgeLabel, closedAge on
  RECENTLY CLOSED lines, plain+HTML lockstep), `conciergeTick.ts`
  (closedAtMs pass-through), unit + acceptance steps.
- No hitchhikers in merge commit; accumulated branch diff vs main includes
  prior landed slices (expected on cleaner branch).

By cleaner.
