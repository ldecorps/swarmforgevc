# One unified pipeline grid across swarms (BL-1009)

## The gap

`backlog/active/` is shared git, so swarm2 tickets already appeared on the
Telegram pipeline board — but with no ownership mark. Two grids on one topic
would waste space; the operator asked for **one** grid, badged per ticket.

## What changed

`pipelineBoard.ts` + `conciergeTick.ts`:

| Rule | Behaviour |
| --- | --- |
| One grid | All active tickets share the same kanban matrix |
| Caption badges | When **more than one** distinct swarm is visible: `primary`→`s1`, `second`→`s2`, else the wire name |
| Mono-swarm | No badges — byte-identical to pre-BL-1009 |
| Absent `swarm:` | Defaults to this host’s name via `readSwarmName` |
| Remote held-by-role | Never shown — this host cannot observe another host’s mailboxes; remote rows stay `not-started` |

Badges ride the **caption** line under the matrix, never an extra grid column
(30-char width budget unchanged).

Wire names stay `primary` / `second`; only the display map is new. Coordinator
still writes `swarm:` on ticket YAML by hand when assigning to s2 (BL-090).

Cross-host live stage merge for remote rows is deferred (pipeline-board epic /
fleet-topology).

## Operator note

Assign with `swarm: second` (or leave blank for local). On a mixed board,
captions show `s1`/`s2`. A single-swarm board looks unchanged.

Acceptance:
`specs/features/BL-1009-one-unified-pipeline-grid-across-swarms.feature`

Related: `docs/how-to/BL-513-pipeline-board-current-folder-links.md`,
`docs/how-to/BL-586-pipeline-board-topic-identity-runbook.md`.
