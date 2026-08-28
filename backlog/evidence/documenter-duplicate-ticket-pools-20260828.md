# Ten tickets duplicated across backlog pools — found while merging BL-1190 (documenter, 2026-08-28)

While merging hardener's `git_handoff` for `BL-1190-ghost-approval-ask-requires-live-yaml`
(commit `e536d1eb3a`) into my worktree, the merge introduced (or surfaced —
already present on the merged-in side) a second on-disk copy of each of
these ten ticket YAMLs, each at a **different pool** than the one already in
my worktree:

| Ticket | Locations found | Content |
|---|---|---|
| BL-1184-briefing-shift-velocity | `active/`, `done/` | byte-identical |
| BL-1188-pipeline-grid-live-stage-parity | `active/`, `paused/` | **diverges**: `active/` copy has `human_approval: approved`, `assigned_to: coder`, `bounce_count: 2` + 2 bounce_history entries; `paused/` copy has `human_approval: pending` and NO bounce_history |
| BL-1189-live-screen-one-primary-working-ticket | `active/`, `paused/` | **diverges**: same shape as BL-1188 — `active/` has `human_approval: approved` + 1 bounce_history entry; `paused/` has `human_approval: pending`, no bounce_history |
| BL-1190-ghost-approval-ask-requires-live-yaml | `active/`, `paused/` | near-identical: `active/` has `assigned_to: coder`, `paused/` does not (1-line diff) — this is the ticket I am actively processing |
| BL-428-decrap-preexisting-high-crap-on-touch | `active/`, `done/` | byte-identical |
| BL-472-wire-babashka-hardening-toolchain | `paused/`, `hold/` | near-identical: `hold/` copy has one extra coordinator note about being moved to hold pending operator activation |
| BL-565-cost-ledger-synthetic-pricing-max-billed-roles | `paused/`, `done/` | **diverges materially**: `paused/` copy is an older draft (`status: todo`, `assigned_to: specifier`, prose-only `acceptance:`); `done/` copy is a later, fuller spec (`status: in_progress`, `assigned_to: documenter`, `required_stages`, `required_wiring`, a real `acceptance:` feature pointer, and a `qa_e2e_procedure`) |
| BL-644-what-not-to-do-when-tweaking-the-swarm | `active/`, `paused/` | **diverges**: `active/` is my own current copy (`assigned_to: documenter`, `acceptance:` pointing at the parked `.feature.draft` I minted this session, `acceptance_prose:` holding the original checklist) — already handed off to QA as commit `4069dfee37` and merged up as `20eac7683`; `paused/` is an older draft (`assigned_to: coder`, inline `acceptance:` prose, no `acceptance_prose:` split) |
| BL-691-ambulance-mode-workflow-gaps-from-bl688-live-run | `paused/`, `done/` | byte-identical |
| BL-882-handoffd-cadence-comment-misleads | `paused/`, `done/` | near-identical: `done/` copy has one extra `assigned_to: coder` line |

## Why this matters

Same shape as the 2026-08-27 `f8a41c1e2` "confirmed identical content"
incident (see prior evidence under `backlog/evidence/BL-1216-*` and
`architect-branch-severely-collapsed-tree-20260827.md`, both merged in
alongside this): several of these pairs are genuinely identical and safe,
but at least three (BL-1188, BL-1189, BL-565) lose real state — bounce
history, human-approval status, or a fuller specifier draft — if the wrong
copy is kept. BL-644 is a live case *right now*: the `active/` copy already
rode through documenter → QA today; the `paused/` copy is a stale
pre-session draft that must not be allowed to silently resurface and
overwrite it.

## What I did NOT do

I did not delete, merge, or pick a side for any of these ten ticket files.
Per the standing rule from the prior incident (never resolve a cross-branch
backlog collision unilaterally — that is coordinator/specifier's call,
Article 3.3), I am leaving every pair exactly as this merge left it and
escalating instead.

## Ask

Specifier/coordinator: please resolve each pair (verify per-ticket, byte
for byte, which pool and which content is authoritative) rather than
trusting either copy's mere existence. BL-1188/BL-1189/BL-565 are the
ones where picking the wrong copy loses real information; BL-644 needs the
`active/` copy (already at QA) kept, the `paused/` draft discarded.

By documenter.
