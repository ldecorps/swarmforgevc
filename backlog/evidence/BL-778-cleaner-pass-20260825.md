# BL-778 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `7b809ca1b3` only
  (`dels_on_origin=0`).
- DRY: `assert_rejected` reuses `run_swarm_handoff` (stderr captured in helper).
- `test_rule_proposal.sh` ALL PASS (01/02/03/03b/04).

By cleaner.
