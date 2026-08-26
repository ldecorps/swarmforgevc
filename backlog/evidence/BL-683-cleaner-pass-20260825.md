# BL-683 cleaner pass — 2026-08-25

## Inbound

Coder tip `55a982ec7f` — hitchhike CLEAN. Rematched onto `origin/main` =
`94149c7279`. Steps index conflict: kept BL-1120 + BL-683 requires.

## Checks run

1. `bl683_backlog_folder_count_property_runner.bb` — ALL PROPERTIES HOLD
2. Gherkin — BL-683 feature — 3/3

## Cleanup performed

- APS steps: extract `countActiveTickets` / `countBacklogYaml` /
  `countStatusSnapshotYaml` so the three-counter scenario does not inline
  duplicate `bb -e` load-file strings; drop unused `targetPath`.

## Forward

`git_handoff` to architect, priority 50, task
`BL-683-handoff-depth-warning-counts-non-tickets`.

By cleaner.
