# Defect — routing skip-trail is bypassed when the sender pre-routes: the FIRST routed hop (BL-617, 14:10Z) left zero skip record

**From:** operator hawk-watch on the first required_stages ticket, 2026-07-24 ~14:20Z
**Severity:** medium (trail/observability guarantee broken; flow itself correct)

## What happened — first routed hop in production

BL-617 declared `required_stages: [coder, qa]` with full `stage_skip_reasons`.
At 14:10:17Z the coder sent `git_handoff` parcel 000627 addressed **directly
to QA** (`to: QA`), skipping cleaner/architect/hardender/documenter. QA
dequeued at 14:11:06Z, mono-router rotated to QA, gate in progress. Outcome:
CORRECT per the declaration.

But: **no `routing_skipped:` header on the parcel, and `.swarmforge/
routing-skips.jsonl` does not exist anywhere in the repo or worktrees.** The
skip left no trail record at all.

## Root cause

`swarm_handoff.bb`'s `:routing-skipped` record (header + jsonl append via
`log-routing-skip!`) is only produced on the REWRITE branch — when the
sender's literal `to:` names a stage NOT in the effective required set and
the router redirects it. The coder, having read the ticket's
required_stages, addressed QA directly; literal-to was already a required
stage, the rewrite branch never ran, and no record was written.

So the visibility guarantee (BL-606 guardrails #2/#6, scenarios 03/08:
"which stages ran vs skipped is answerable from the recorded trail, not
inferred from the diff") holds only when agents are naive about routing.
The FIRST real agent was not naive — it pre-routed — and the trail went
silent. This is the exact "silent skip" class the human flagged as their
predictability fear when approving BL-606.

## Fix shape (specifier confirms)

The skip record must be derived from WHAT THE HOP ACTUALLY SKIPPED, not
from whether the router rewrote it: at send time, for a git_handoff on a
ticket with valid required_stages, compute skipped = canonical stages
strictly between sender and the DELIVERED recipient (same
hop-skipped-stages logic, same inclusive rules as the rewrite branch) and
emit the header + jsonl record whenever that set is non-empty — regardless
of who chose the destination. The rewrite branch then becomes just one
producer of the same record. Fixture: this exact incident — coder sends
`to: QA` directly on a [coder, qa] ticket => record names
cleaner,architect,hardender,documenter with the ticket's declared reasons.

Note for completeness: BL-617's stage_skip_reasons ARE on the ticket yaml,
so the DECLARED intent is greppable there; what is missing is the runtime
record that the hop actually honoured it. Both halves are needed for the
after-the-fact answer the contract promises.

## Evidence

- Parcel: `.worktrees/coder/.swarmforge/handoffs/sent/00_20260724T141017Z_000627_from_coder_to_QA.handoff` (no routing_skipped header)
- `find . -name routing-skips.jsonl` => no matches (14:20Z)
- Send-path code: swarm_handoff.bb ~398-460 (record only on rewrite branch)
- BL-617 flow otherwise healthy: QA dequeue 14:11:06Z, active-role=QA
