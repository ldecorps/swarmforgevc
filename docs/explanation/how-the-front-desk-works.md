# How the front desk works

A human message in Telegram reaches the swarm — and an answer gets back —
through several processes and two auth guards. The bot never talks to the
Operator runtime directly; every hop goes through the bridge. The activity
diagram is `docs/diagrams/front-desk-flow.mmd` (morning-briefing name
`front-desk`).

## The surprising constraint

The agent that answers you is the **restricted** front-desk Operator,
spawned roughly as `claude -p --tools ""`. It receives a full self-contained
prompt (contract, that subject's thread transcript, long-term operator
memory) and has **no Read tool and no repo access**. Every "why didn't it
know about X in the tree?" traces back to that boundary — not to a missing
Telegram hop.

## Inbound (bot decisions, in order)

1. Poll `getUpdates`; drop anything not from the principal in the bound chat.
2. One of the eight **role** topics → steering redirect into that role's
   pane as a verified nudge, plus a delivery receipt. Topic scope is checked
   **before** auth on the steering path.
3. A **reserved** topic (Approvals / Recert / Agent Questions / Control) →
   that topic's own handler, never ordinary SUP routing.
4. A voice note in the Concierge topic → whisper-1 transcription (voice is
   scoped to that topic only).
5. Otherwise resolve the subject: a bound topic posts to its existing
   `SUP-###`; an unmapped topic or a DM mints a fresh `SUP-###` and records
   the binding.
6. `POST` to the bridge's authed `/telegram-inbound` (fire-and-forget, never
   RPC). The bridge appends an operator event to
   `.swarmforge/operator/events.jsonl`.

## Operator side

`operator_runtime.bb` reads events, claims **one** subject's worth, writes
inflight + dispatch-context files, composes the self-contained prompt, and
spawns the restricted run on its own tmux socket. The restricted Operator
then does exactly one of:

- `operator_reply.bb` — answer in-thread, or
- `operator_file_question.bb` — write **and commit**
  `backlog/INTAKE-<slug>.md`, then reply in the same call.

The specifier drains the backlog root before other work, so filing needs no
extra routing decision.

## Outbound

The reply is appended to `telegram-reply-outbox.jsonl` and the thread
transcript. The bot picks it up over the bridge SSE stream and posts into
the mapped topic. A voice-originated turn comes back as a synthesized opus
voice note instead of text.

## Related

- Diagram: [front-desk-flow.mmd](../diagrams/front-desk-flow.mmd)
- Briefing allowlist entry: [BL-580 how-to](../how-to/BL-580-front-desk-mechanism-briefing-diagram.md)
- Shared-token fan-out with Cursor bridge: [BL-764](../how-to/BL-764-front-desk-shared-token-bridge-fanout.md)
