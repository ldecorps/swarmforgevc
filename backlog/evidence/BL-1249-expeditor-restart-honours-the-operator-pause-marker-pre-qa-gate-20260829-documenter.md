# Documenter finding — BL-1249 pre-QA ancestry gate demands a harmful merge (2026-08-29)

## What happened

Documentation for BL-1249 was already written and QA-approved earlier
(`cca6eb099`/`e42c1dd5f`, merged by QA at `5b7427636`). This turn only
received a hardener re-forward after a `require('node:test')` Vitest
registration fix (same class as BL-1244's). No new documentation needed;
attempted to forward the merged hardener commit (`76070356bc`) unchanged.

`swarm_handoff.sh` refused: `PRE_QA_GATE_FAIL ancestry BL-1249 559d9bd19a
stranded on swarmforge-architect`.

## Why I did not merge it

`559d9bd19a` ("Merge main into architect: main parked BL-1233, BL-1234,
BL-1242, BL-1244, BL-1247, BL-1249 ... active/ -> hold/") is a batch
park-sweep commit. Its only BL-1249-specific content is moving
`backlog/active/BL-1249-*.yaml` to `backlog/hold/` — a park action already
reflected in this worktree's current state (the file is in `backlog/hold/`
here too).

Attempting the merge, the merge-deletion guard (BL-1242/commit-msg hook)
refused it outright:

```
Error: commit deletes 'backlog/active/BL-1233-...yaml' (BL-1233), which
appears at no other staged path and is not named in the commit message.
[... same for BL-1234, BL-1242, BL-1244, BL-1247, BL-1249 ...]
Commit rejected: name the ticket id in the commit message to confirm a
deliberate retirement.
```

Completing this merge would have retired/deleted six active tickets'
YAML files, including this ticket's own and BL-1244's (documented and
forwarded to QA earlier this session). Aborted.

## Pattern

Same shape as the BL-1238 escalation this session
(`BL-1238-...-bounce-20260829-documenter.md`): the PRE_QA_GATE ancestry
check is demanding merges of park/main-sync commits whose ancestry itself
carries other tickets' currently-bounced or unrelated in-flight state, and
in this case the guard confirms the merge is actively destructive. This
looks systemic to today's park/unpark churn across active tickets, not a
documenter-fixable gap.
