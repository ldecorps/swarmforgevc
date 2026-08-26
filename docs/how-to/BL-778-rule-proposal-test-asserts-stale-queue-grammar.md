# Rule-proposal shell test asserts real handoff queue grammar (BL-778)

`swarmforge/scripts/test/test_rule_proposal.sh` (BL-035) used to assert
`^HANDOFF QUEUED:` — a string `swarm_handoff.bb` has never printed. Under
`set -e` the suite aborted at scenario 01, so scenarios 02–04 never ran.

## Fix (already on the parcel)

- Pin mailbox-only delivery (`SWARMFORGE_SKIP_SYNC_INJECT=1`) and scrub ambient
  delivery-mode env vars before the fixture runs.
- Assert the real success line:
  `HANDOFF QUEUED (mailbox only, no tmux inject):`

## When writing or grepping handoff tests

Use the full success grammars in
[Handoff dual-path delivery](../explanation/handoff-dual-path.md#success-stdout-grammar-what-tests-must-assert).
Do not loosen to a bare `HANDOFF QUEUED` substring — that can go green on a
non-success send.

Acceptance: `specs/features/BL-778-rule-proposal-test-asserts-stale-queue-grammar.feature`.
