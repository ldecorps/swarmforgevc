# Raw intake — Workflow Canary (refactor tracer bullet → Canary)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket. Picture mock of the Canary hop journey emailed to
notify_email_to the same evening for phone review.

Related
- Existing tracer-bullet harness, launcher, trace-hop CLI, and per-role
  "Tracer Bullet Participation" prompt blocks (M2 reliability layer;
  BL-029 noop pipeline smoke; BL-136 hop-chain completeness).
- BL-121 canary injector is a different beast (synthetic handoff delivery
  health for the transport). Do not conflate: this intake is the
  **workflow / role-chain Canary** (ticket-shaped work that traverses
  agents and records hops), not the parcel-delivery canary.
- Operator intent: land this **before** a deliberate full-pack restart day,
  so the pack can be proven with a recorded Canary pass rather than hope.

## Goal

Rename and reshape the old tracer bullet into a first-class **Workflow
Canary**: a non-feature work item that every pipeline role must take, do
nothing product-wise, hand to the next role, and **record** what happened
(who, when, decision, dwell, handoff latency, retries). One durable report
shows whether the live workflow is healthy end to end.

## Problem

- Tracer bullet already exists but naming and product framing are stale;
  humans now say "Canary" for the same job.
- Before restarting full pack after mono-router / workflow changes, the
  operator wants a deliberate Canary run with a clear pass/fail trace —
  not a real feature ticket and not a silent hope that handoffs work.
- Today the story is split across launcher harness, watch mode, role
  prompt blocks, and old docs; refactor should make "run the Canary"
  one obvious operator verb and one readable report.

## Why this matters

- Full pack restart without a Canary is expensive when a hop is broken.
- A recorded traverse answers "did each agent take it and pass it on?"
  with evidence, not chat anecdotes.
- Same instrument later feeds health trends (sibling Bubble intake) once
  Canary runs are durable and named consistently.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Wait on full pack.** Do not rush a full-pack restart tonight; Canary
   comes first as the preflight for the day the human chooses to restart.
2. **Not a feature.** The Canary ticket / work item implements nothing of
   product value. Its only job is to exercise and record the workflow.
3. **Record the traverse.** Every hop must leave a durable trace: role,
   timestamps, decision, and outcome. A final report must be readable by
   a human (and later by a health screen).
4. **Refactor, do not invent a second parallel system.** Evolve the
   existing tracer-bullet launcher, trace store, role participation
   blocks, and docs into Canary naming and full-pack-era chain coverage.
   Kill dual vocabulary (tracer bullet vs Canary) in prompts and how-tos.
5. **Epic-shaped.** Human asked for an epic (intake first): refactor work
   plus the ability to run a Canary — not a single orphan ticket with no
   rename of the old surface.
6. **Distinct from delivery canary.** Specifier must keep BL-121-style
   transport canaries separate in naming and docs so operators are not
   confused.

## Requested outcome

1. Epic (or epic + slices) that renames and refactors tracer bullet →
   Workflow Canary across launcher, CLI, role prompts, tests, and docs.
2. Operator-clear way to seed / watch a live Canary through the real
   swarm (full classic chain, not a truncated harness-only story).
3. Durable per-hop log plus a human-readable end report (pass if every
   expected role hopped forward; fail with which hop stalled or retried).
4. How-to line: when to run Canary (especially before full-pack restart).
5. No product code change required for a green Canary (noop work only).

## Acceptance shape to refine

1) Running the Canary on a live pack produces a complete hop trace for
   every forward role in the configured pack.
2) Role prompts say Canary (not tracer bullet) and still forward with no
   implementation work.
3) Harness mode still passes in CI; watch mode still works against live
   agents.
4) Docs and npm/script names use Canary; old tracer-bullet aliases either
   redirect or are removed in the same epic.
5) A failed or stalled hop is obvious in the report (which role, how long).

## Out of scope

- Minting without specifier disposition.
- Starting full pack as part of this intake.
- Bubble UI for trends (sibling intake).
- Changing BL-121 transport canary semantics.
- Real feature work disguised as the Canary payload.

## Suggested type / priority hint for mint

- type: epic (reliability / operator preflight), with rename + prompt +
  launcher + docs slices
- mutation_cost: medium (wide rename surface; behavior should stay
  mostly equivalent)
- Priority: before the human's chosen full-pack restart day
- Not offline expeditor unless the human asks

## Specifier: please weigh in

Open questions the human did not fully lock:
- Exact Canary seed shape: backlog YAML ticket vs note-only parcel vs
  dedicated canary task id.
- Whether Canary must run under mono-router as well as full pack, or
  full-pack-only is enough for v1.
- Retention and location of Canary reports (traces dir only vs also
  evidence/ or briefing sidecar).
- Compatibility window for the string "tracer bullet" in old evidence.
- Whether a scheduled / periodic Canary (like BL-121 cadence) is in
  scope or only on-demand operator runs for v1.
