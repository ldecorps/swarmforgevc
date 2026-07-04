source: operator request, 2026-07-04 (coordinator relay)

Observation: each pipeline role runs as one continuous, long-lived `claude`
process for the life of its tmux pane (launched once by
.swarmforge/launch/<role>.sh). Nothing in the handoff protocol or queue
helpers (ready_for_next.sh / done_with_current.sh) ever clears that
session's context between handoffs — a role's context accumulates across
every task/batch it processes for as long as the pane lives. Only a human
running /clear, or a full pane respawn, resets it today.

Requested behavior: make context-clearing after a handoff OPTIONAL and
config-controlled (a feature flag, on/off), not mandatory or automatic.
When enabled, a role should clear its own session context at a natural idle
boundary — after done_with_current.sh completes a task/batch and the queue
comes back NO_TASK — not mid-task and not mid-batch.

Default (on vs off): left to the specifier's judgment — pick whichever
default the spec's own reasoning supports, no operator preference either
way.

Granularity: consider a two-level config shape rather than one global
switch — a swarm-wide default (on/off) plus an optional per-role override
(e.g. per `window <role> ...` line in swarmforge.conf, or a parallel
per-role key), so an individual role can be flipped against the swarm-wide
default without changing it for everyone. Follow the existing
swarmforge.conf convention (see how `active_backlog_max_depth` and the
per-role `window` lines already work) rather than inventing a new config
mechanism.

Motivation raised in discussion: long-running batch roles (hardener,
documenter) accumulate context/cost over many parcels with no clear benefit,
since durable knowledge already lives in git history, backlog/done/, and
the memory system rather than in-session recall. Tradeoff to weigh in the
spec: losing any in-session short-term coherence a role had built up, plus
whatever mechanism is used to trigger the actual clear (this is swarm
machinery / launch-script territory, not extension code — likely
swarmforge/scripts + swarmforge.conf, not extension/src).

Ask: specifier to write a proper spec (description + Gherkin acceptance)
for a config-flagged, idle-boundary-only context clear, then place it in
backlog/paused/ per normal intake.
