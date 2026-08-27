# BL-786 — cleaner pass — 20260825

- merge_and_process coder tip `799d9c0df4` (clean cherry-pick).
- `resolve-mutation-concurrency.ts` + `mutation-concurrency.js` wire npm
  mutation scripts to host-sized workers; pin via `MUTATION_CONCURRENCY`.
- Tests: `node --test extension/test/resolveMutationConcurrency.property.test.js`
  4/4 pass. `dels_on_origin=0`.

By cleaner.
