# BL-1031 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `b03e1263bb` (route handoff_inject / pre_qa_gate_gather /
salvage through `daemon-cycle-guard-lib/sh!`; retire BL-1022 ratchet empty;
wait-bound fail-CLOSED on acceptance-contract path) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor b03e1263bb HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb`:
   ALL PASS (spawn-only banned-API debt `[]`).
2. **Babashka unit** —
   `bb swarmforge/scripts/test/acceptance_contract_gate_lib_test_runner.bb`:
   ALL PASS.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree.feature`:
   7/7 pass.

## Cleanup performed

- `pre_qa_gate_gather_lib.bb`: extracted `wait-bound-hit-result?` so the
  gherkin-parser and resolve_contract_steps call sites share one named
  exit-124 predicate.

## Findings beyond that

NONE. `:dir` / result contracts preserved; wait-bound remains a finding, not
a silent fail-open warning.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By cleaner.
