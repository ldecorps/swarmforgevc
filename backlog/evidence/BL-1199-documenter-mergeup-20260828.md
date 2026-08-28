# BL-1199 — documenter merge-up — 20260828

Merged QA's merge-up commit `b8a11849f8` (rematch-tip-onto-origin/main
before BL-1199 land) into my worktree. Four conflicts:

- `backlog/active/BL-1195-....yaml`, `specs/pipeline/steps/index.js`,
  `swarmforge/scripts/ready_for_next.bb`,
  `swarmforge/scripts/test/suite-manifest.tsv` — all the same shape: QA's
  side (surgically) declined BL-1195's still-in-flight content out of the
  BL-1199 delivery, per their own evidence
  (`backlog/evidence/BL-1199-qa-pass-20260828.md`, "Declined BL-1195's
  bundled content"). But BL-1195 is not abandoned content here — it is my
  own already-completed, already-forwarded work: I documented it
  (`docs/how-to/BL-1195-worktree-drift-guard.md`, linked from
  `docs/index.md`) and sent its own `git_handoff` to QA at
  `2026-08-28T00:46:51Z` (`.swarmforge/handoffs/sent/00_20260828T004651Z_*`),
  a separate parcel QA hadn't reached yet when it built the BL-1199
  delivery from an earlier ancestor. Resolved all four in HEAD's favor
  (kept BL-1195's content), matching QA's own declared intent — QA
  declined bundling it into *this* delivery, not the ticket itself.

- Git's clean auto-merge also silently DELETED 8 real BL-1195 deliverable
  files (`worktree_drift_lib.bb`, its tests/property-runner, the step
  handler, 3 evidence files) because my copies were byte-identical to the
  merge-base and QA's side had removed them for the same surgical-decline
  reason above. Restored all 8 from HEAD (`git checkout HEAD --`) — leaving
  them deleted would have broken the `index.js` require I kept for the
  step handler and silently dropped BL-1195's real shipped work (BL-954/
  BL-956 class: a merge dropping other-ticket content with no conflict
  marker to flag it).

No doc changes needed beyond what BL-1195's own pass already made — this
merge doesn't change user-visible behavior, just reconciles two lineages.

By documenter.
