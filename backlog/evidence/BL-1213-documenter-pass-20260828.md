# BL-1213 documenter pass — 2026-08-28

Merged hardener's `747d7c4ce8` (fixed an unconditional fixture-directory
leak in the acceptance step file; no behavior change to the guard itself).
One conflict in `specs/pipeline/steps/index.js` — union of both sides'
requires (all five entries already legitimately present elsewhere in the
codebase, deduplicated to one occurrence each).

## Documentation

New how-to: `docs/how-to/BL-1213-parcel-rollback-guard.md` (what it
catches, what it deliberately doesn't, how to clear the refusal, where it
lives). New section in `swarmforge/handoff-protocol.md` alongside the
other three send-time gates (duplicate-chain, task/commit coherence,
ticket-close) — this is the natural sibling location, not the PRE_QA_GATE
section (this guard fires on every `git_handoff` send, not just QA-bound
ones). Linked from `docs/index.md` next to the BL-1195 drift-guard entry.
Added a `Specification.MD` changelog entry at the top, dated 2026-08-28.

Corrected one dangling cross-reference while writing the how-to: BL-1098
(the push-sweep predicate this guard's shape deliberately does not
reimplement) has no dedicated how-to page — pointed at the BL-1085
push-sweep doc that covers it instead of inventing a broken link.

Forwarded to QA, task
`BL-1213-forward-refused-when-branch-rolled-back-a-parcel`, tip
`f2e6968a22`. Confirmed the new guard itself passed clean on this send
(no `PARCEL_ROLLBACK WARNING`/block) — a fitting first real-world exercise
of it.

By documenter.
