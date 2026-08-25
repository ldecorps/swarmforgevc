# BL-1080 cleaner pass — 2026-08-25

## Inbound

Coder tip `530f93a5e9` (APS dual-literal lock + property after architect bounce)
on product `9e5bff066`. Hitchhike CLEAN. Rematched **1080-only** onto
`origin/main` = `cb12bfd8ba`.

Earlier cleaner tip `fe9ae59af6` folded refusals into a helper and failed APS;
architect bounced. This tip encodes the dual-literal constraint in a property
runner (`refuse_unsupported_agent` forbidden). A later batch wrongly marked
coder→cleaner `001029` completed without this pass — recovered here.

## Checks run

1. Gherkin — BL-1080 feature — 3/3
2. `bl1080_cursor_seat_property_runner.bb` — ALL PROPERTIES HOLD
3. `test_coordinator_provider_configurable.sh` — ALL PASS

## Cleanup performed

- NONE — dual literal refusals are APS-locked; property runner already guards
  against collapsing them.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1080-a-pack-can-name-cursor-on-a-window-line`.

By cleaner.
