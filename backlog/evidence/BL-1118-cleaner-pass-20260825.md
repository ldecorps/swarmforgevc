# BL-1118 cleaner pass — 2026-08-25

## Inbound

Coder tip `339df1e41d` (8-file tip surface; hitchhiked ancestry). Cherry-picked
onto hitchhike-free cleaner tip as `b2e5ee418`.

Hitchhike gate vs origin/main: CLEAN for stacked surfaces.

## Checks run

1. `post_hotfix_merge_origin_lib_test_runner.bb` — ALL TESTS PASSED
2. `bl1118_post_hotfix_merge_property_runner.bb` — ALL TESTS PASSED (after
   property scope fix)

## Cleanup performed

- Property runner: scope assertions to the stale-*dirty* honesty invariant
  (unit tests lock that conflict surfaced may remain on a clean tree; the
  prior grid wrongly failed that case).
- CLI: extract `porcelain-paths` for dirty-path listing.

## Findings beyond that

Feature file exists on coder/master but was not in tip `339df1e41d`. Cleaner
did not invent Gherkin.

## Forward

`git_handoff` to architect, priority 00, task
`BL-1118-post-cursor-batch-merge-origin-main`.

By cleaner.
