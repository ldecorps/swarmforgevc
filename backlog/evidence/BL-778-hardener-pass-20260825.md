# BL-778 hardener pass — 20260825

**Architect tip:** `e820a1534a` (cleaner `0c1700f6e1` / coder `7b809ca1b3`)
**Task:** `BL-778-rule-proposal-test-asserts-stale-queue-grammar`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **6 paths**, **0 deletes** (pre-evidence).

## Product surface

`test_rule_proposal.sh`: pin `SWARMFORGE_SKIP_SYNC_INJECT=1`, scrub ambient
delivery env, assert real
`HANDOFF QUEUED (mailbox only, no tmux inject):` grammar.
Authorize **BL-778 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `test_rule_proposal.sh` | ALL PASS |
| APS BL-778 feature | 9/9 |
| Soft Gherkin | runner hung / no outcome — not treated as pass; surgical used |
| Surgical | killed=5 survived=1 skipped=0 |

## Surgical notes

**Killed:** stale-delivered-grammar, drop-skip-sync-pin, wrong-queued-prefix,
unset-skip-sync, assert-always-pass (APS non-vacuous scenarios).

**Survivor:** `scrub-incomplete` (MAILBOX_ONLY scrub alone equivalent under
pinned SKIP_SYNC=1).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-778 only.

By hardender.
