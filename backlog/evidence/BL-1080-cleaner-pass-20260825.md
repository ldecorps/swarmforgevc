# BL-1080 cleaner pass — 2026-08-25

## Inbound

Coder tip `6baf744487` — hitchhike CLEAN. Rematched **1080-only** onto
`origin/main` = `cb12bfd8ba` (not stacked on BL-1116).

## Checks run

1. Gherkin — BL-1080 feature — 3/3
2. `test_coordinator_provider_configurable.sh` — ALL PASS

## Cleanup performed

- `swarmforge.sh`: extract `refuse_unsupported_agent` so validate_agent and
  the launch `*)` arm share one message+exit path (no drift).

## Forward

`git_handoff` to architect, priority 50, task
`BL-1080-a-pack-can-name-cursor-on-a-window-line`.

By cleaner.
