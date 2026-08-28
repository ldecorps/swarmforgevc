# BL-1192: Pre-Handoff Task-Scope Gate

`swarm_handoff.sh` refuses a `git_handoff` whose cited commit is entangled
with another ticket's work — not only at the documenter→QA edge (BL-531's
job), but on **every** hop: cleaner, architect, hardener, documenter, and QA
alike. The 2026-08-27 shift logged ten QA bounces classed `behavior`; the
measured subset (BL-596, BL-754, BL-780, BL-980, BL-1173, BL-1174) shared one
cause — a handoff named ticket A but cited a commit whose diff also carried
ticket B's backlog YAML, feature file, or how-to doc. Each cost a full QA pass
and a rebuild. This gate catches the same shape where it first appears
instead of five stages later.

## What triggers it

The check fires only on `type: git_handoff` sends with a `task:` header. It
walks every commit **since the commit most recently handed off for this
exact task** (the durable handoff archive — never grepped or guessed) up to
the commit you're citing, but counts only commits whose own subject line
names this task's ticket id. For each of those commits' own changed paths,
if a path's basename positively names a *different* ticket id — via the same
exact-id-equality extractor BL-953's coherence gate uses — the send is
refused.

This is deliberately narrower than "the cited commit's full diff against
`origin/main`": that range explodes on a real batch role's branch, which
legitimately accumulates other, already-forwarded tickets' commits long
before `origin/main` catches up. Only paths carrying a deterministic id in
their own name are ever flagged — `backlog/**/*.yaml`, `backlog/evidence/*.md`,
`specs/features/*.feature`, `docs/how-to/*.md`. A functional code path (e.g.
`extension/src/foo.ts`) has no id in its own name and is never flagged by
this gate on its own; that silence is not a claim of clean scope, it's this
gate's blind spot, covered structurally by the same fail-open posture below.
A task's own `backlog/evidence/<task-id>-*` files never count as foreign
overlap — that's the task's own paperwork.

## Example refusal

```
Cannot send git_handoff for BL-1174-<slug>: this task's own commits since
its last handoff carry a path (backlog/active/BL-1185-<slug>.yaml) belonging
to BL-1185, not to BL-1174 - the tip is entangled with another ticket's work
(BL-1192/BL-506). Rebuild or cherry-pick a tip-pure commit for BL-1174 and
re-send.
```

## How to fix

Rebuild or cherry-pick a tip-pure commit for your own task, carrying only
your own ticket's paths, and re-send. If the previously-cited commit for
this task is being deliberately abandoned in favor of a rebuild off
`origin/main` (BL-1241's escape hatch for a tip that is genuinely
entangled), record that commit's sha under the ticket's own
`abandoned_commits:` field first — the walk then starts from `origin/main`
for this parcel instead of from a commit the new tip does not descend from,
so the rebuild's own tip-pure paths are not mistaken for foreign overlap.
This is the same `abandoned_commits:` mechanism BL-531's ancestry check
already uses (see `docs/how-to/BL-531-handoff-refusal-remedies.md`).

## Fail-open, always

Every one of these accepts the send rather than blocking it, the same
posture as BL-953/BL-972:

- `origin/main` cannot be resolved.
- The cited commit's history is unreadable.
- The task name resolves to no ticket id.
- Every changed path resolves to no ticket, or only to the task's own.

An unreadable walk prints `TASK_SCOPE WARNING: ...` to stderr and the send
proceeds — never a silent skip.

## Testing the gate locally

`specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh` drives the real
`swarm_handoff.bb` end to end against a scratch git fixture (never a
reimplementation of the gate) and is what
`specs/features/BL-1192-pre-handoff-task-scope-gate.feature` exercises.
