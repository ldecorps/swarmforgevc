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

## Declared-path exemption (BL-1276)

A path is also **not** foreign when the ticket's own landed YAML (freshest of
`main`/`origin/main` — never the sender's working copy, so a specifier
amendment is honoured without the sender merging first) declares it in one
of two fields, read through one `declared-exempt-paths` accessor:

- `acceptance:` — a defect against a shipped check amends the durable
  contract for that check rather than forking it, so the one file the
  ticket must edit is the one file the gate would otherwise see as foreign.
- `retires:` — a list of exact paths belonging to ANOTHER ticket that this
  ticket is chartered to retire or re-tense. BL-1006 requires exactly this
  shape ("retire, never reword": a retirement ticket, by construction,
  edits the superseded ticket's `.feature` file), so before this the gate
  refused a constitutionally mandated edit — BL-1246's fully tested,
  committed cleanup of BL-1248 scenario 04 had no move that did not either
  violate its own spec or defeat the gate.

Exact strings only, one path per `retires:` entry — no glob or prefix
expansion, and declaring a feature file does not exempt that ticket's YAML
or evidence files too. A ticket that cannot be resolved on any ref grants NO
exemption, and the refusal says the exemption could not be evaluated. The
`RETIRE-WITH: <id>` comment convention some feature files carry is
documentation only — never read by the gate, and not required to agree with
`retires:`. See `swarmforge/backlog-schema.md`'s `retires` row for the full
field contract.

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
