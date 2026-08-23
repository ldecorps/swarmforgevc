# ACP-Hosted Seat Snapshot (BL-1081)

Every seat's idle and permission-blocked state is normally *inferred* from
its tmux pane: a busy footer, a pane-hash comparison across sweeps, a regex
match against an interactive-menu prompt. Each of those inferences is
defeated a different way (a truncated tail, a ghost suggestion, a lying
`pane_current_command`, a menu-shaped tool title), and BL-1081 spikes an
alternative for agents that speak the Agent Client Protocol (ACP) natively:
read the fact instead of guessing it from text.

This is a spike, and it is falsifiable — see `approval_context` and
`qa_e2e_procedure` on `backlog/active/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.yaml`
for the verdict criteria. What is documented here is what is built as of this
parcel: the snapshot file, the deterministic-layer read side, and the
provider-table dimension. **No production launcher spawns the ACP host yet**
— see [What is not wired](#what-is-not-wired-yet) below.

## The provider table gains a dimension, not a fork

`swarmforge/scripts/prompt_engine_lib.bb`'s `provider-capabilities` table
gained an `:acp` field, read via `acp-native?`. Absence of the key reads as
`false` (pane-driven), never as unknown — adding a new agent needs no edit
here to stay safe. Per the source intake, the ACP-native agents are
`copilot`, `vibe` (Mistral Vibe), and `gemini`; `claude`, `codex`, `grok`,
and `mock` are unmarked. `:acp true` on the table means only "this CLI speaks
ACP" — it does not by itself mean any running seat is currently ACP-hosted;
that is answered per-seat by whether a snapshot file exists (below).

Cursor is deliberately absent from this table: BL-1078 found `cursor-agent`
is terminal-native and needs no ACP host to staff a seat, so it is a
different question from this ticket's.

## The snapshot file

One file per seat, written by the extension-host module
[`extension/src/swarm/acpHostRuntime.ts`](../../extension/src/swarm/acpHostRuntime.ts)
and read by [`swarmforge/scripts/acp_session_lib.bb`](../../swarmforge/scripts/acp_session_lib.bb):

```
.swarmforge/acp/<role>.json
```

The path is computed by `acpSnapshotRelPath(role)` on the TS side and
`snapshot-path` on the bb side — both must agree, and
`bl1081_acp_snapshot_agreement_test_runner.bb` is the gate that catches drift
between them (BL-897: "kept in sync" as a comment is not a gate).

Fields, all scalars (deliberately flat and boring across a language boundary
no import bridges):

| Field | Type | Meaning |
|---|---|---|
| `role` | string | the seat this snapshot belongs to |
| `acp` | `true` | present and `true` only for a genuinely ACP-hosted seat; a snapshot missing this (or missing entirely) reads as "not ACP-hosted" |
| `stopReason` | string \| null | the structured stop reason of the last completed turn, or `null` if no turn has ended yet |
| `idle` | boolean | the idle verdict, taken from `stopReason` / pending permission / running tools — never from pane text |
| `idleFrom` | string | which structured fact the idle verdict came from (e.g. `stop_reason:end_turn`, `permission_requested:<tool>`, `tool_running:<tool>`, `no_turn_ended`) — a decision trail, not just a verdict |
| `permissionPending` | boolean | is the seat blocked on a structured permission request |
| `permissionTool` | string \| null | which tool the pending permission request names, if any |
| `turnsEnded` | number | how many turns have completed — distinguishes "not started" from "idle" |

A missing or corrupt snapshot file is read as **absent**, on purpose: a seat
whose ACP channel is not answering falls back to the ordinary pane path
rather than stranding.

## How the babysitter consumes it

`babysitter_check.bb`'s `gather-role` — the live per-role decision site,
reached in production via `babysitterd.sh` / `babysitter_check.sh` — now
loads `acp_session_lib.bb`, reads the seat's snapshot, and folds the
resulting facts onto the same assessment input the pane path already built,
via `acp-session-lib/apply-acp-facts`. The pane capture is untouched: the
host renders the transcript into the pane so a human and the babysitter's
pane checks keep working from it (invariant 2 of the ticket) — this is
additive, not a replacement of the pane as a surface.

Two `babysitterd_sweep_lib.bb` checks change behavior for an ACP-hosted seat
specifically:

- **`check-busy-frozen`** (the busy-footer + unchanged-pane-hash heuristic)
  is skipped entirely for an ACP-hosted seat (`acp?` true) — the stop reason
  already answers whether the turn ended, so the pane-hash inference has
  nothing to add and nothing to get wrong.
- **`check-acp-seat`** (new) raises a `CRIT` when an ACP-hosted seat is
  blocked on a structured permission request. This is a *different* finding
  key and message from the interactive-menu CRIT — a menu block means the
  agent is frozen waiting on a keystroke, a structured permission request
  means it is waiting on a decision that can be routed. The interactive-menu
  pattern match itself is suppressed for an ACP-hosted seat
  (`menu-check-applies?` returns `false`), so the two checks never both fire
  for the same permission moment.

## What is not wired yet

No production script currently constructs an `AcpHostSession` and spawns a
CLI as an ACP subprocess inside a pane — grepping the repo (excluding tests
and the module's own step-handler file) for `AcpHostSession`,
`acpHostRuntime`, or `acp_session_lib` turns up only the runtime module
itself and the two consumers documented above. Marking an agent `:acp true`
in the provider table does not, by itself, change what runs in that seat's
pane; it only changes what the babysitter *would* do if a snapshot file
existed. The launcher/spawn side — actually hosting a CLI (Mistral Vibe is
the proposed seat) as an ACP subprocess in production and driving a real
pipeline parcel through it — is the remaining falsifiable work the ticket's
`qa_e2e_procedure` describes; its outcome (built out, or "reject for our
control model") is not yet recorded.

## See also

- [Non-Pipeline Agents — Reference Table (BL-643)](BL-643-non-pipeline-agents-reference-table.md) — the wider agent/launcher landscape this table sits beside.
- `backlog/active/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.yaml` — the ticket, its falsifiable criteria, and the acceptance scenarios.
