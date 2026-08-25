# BL-1129 cleaner pass — 2026-08-25

## Inbound

Coder tip `d086663a2c` — hitchhike CLEAN. Rematched **1129-only** onto
`origin/main` = `cb12bfd8ba`.

## Checks run

1. Gherkin — BL-1129 feature — 2/2
2. `babysitterd_sweep_lib_test_runner.bb` — ok
3. `babysitterd_sweep_lib_property_runner.bb` — ok

## Cleanup performed

- NONE — rotate gate reuses the existing BL-804 `rotation-router?` flag;
  APS steps are already a thin check driver.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1129-babysitter-rotate-not-honored-skips-standing`.

By cleaner.
