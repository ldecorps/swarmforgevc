# BL-1087 — documenter pass — 20260823 (Article 4.4: NONE)

Received hardener tip `bf0f9f7391` (BL-1087 hardener pass). Merged into the
documenter worktree as `9fb081dd7f`. Parcel task name is BL-1087 only.

## Scope (what the parcel changed)

Stop describing the withdrawn qwen-code mono-router seat: remove the dead
runbook and its index link, re-tense the BL-1052/BL-1053 shipped-work
entries to record the supersede (pointing at
`backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md`), and
gate `docs/` pack-conf drift via `namedPackConfDrift` (illustrative
`swarmforge/packs/NAME.conf` exempt). The aider-based `qwen-mono-router`
path is out of scope and left untouched.

Coder tip `f13a3483fe` already carried the runbook deletion, index unlink,
re-tense, and drift gate. This pass confirms those docs against the ticket
checklist, refreshes `docs/reference/Specification.MD` **Last Updated** for
BL-1087 (same date as the content change; header had still led with
BL-1086), and records the review inventory.

## Documentation checklist

| Check | Result |
|---|---|
| Runbook `docs/how-to/BL-1052-qwen-code-mono-router-launch.md` | ABSENT |
| `docs/index.md` link to that runbook | ABSENT |
| BL-1052 / BL-1053 shipped-work entries | Re-tensed; each names the supersede disposition evidence; no false present tense that the removed conf/runbook/runners currently exist |
| `docs/` pack-conf drift invariant | Covered by `extension/src/docs/namedPackConfDrift.ts` + unit tests (7/7 green this pass) |
| Architecture / swarm-flow diagrams (`docs/diagrams/`) | Topology unchanged — no diagram edit |
| Aider `qwen-mono-router` path | Conf present; `start-swarm-qwen.sh` present; ancillary `qwen` count unchanged vs `main` (5) |

## Inventory

NONE.

Forward this commit to QA (BL-536: never the bare received hash).
