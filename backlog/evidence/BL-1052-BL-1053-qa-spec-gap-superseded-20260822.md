# BL-1052 / BL-1053 — QA spec-gap: parcel superseded in flight, not approved, not bounced

- **Parcels held**: `00_20260822T223510Z_000481_from_documenter_to_QA_for_QA`
  (BL-1052, commit `82973dd3f3`). BL-1053's own separate parcel (per Article
  2.6, hardener forwarded it as its own `git_handoff` alongside BL-1052 per
  `backlog/evidence/BL-1052-BL-1053-hardener-pass-20260822.md`) had not yet
  reached my inbox when this was discovered.
- **Discovered by**: QA, 2026-08-22, mid-review of BL-1052.

## What happened

I fully reviewed BL-1052 (qwen-code seat) before discovering the problem:
independently re-ran `test_qwen_code_seat.sh` (9/9 PASS), the property
runner (`ALL PROPERTIES HELD`, 200 map runs + 40 launch runs), and the
acceptance suite (8/8) — all green, matching the coder's, architect's and
hardener's own evidence exactly. I independently re-verified the two
security-sensitive invariants (capability-vs-model separation; the API key
reaching the pane only via the launching environment and tmux `-e`, never a
committed file) by direct code read, matching the architect's own careful
verification. This was thorough, careful, well-tested work.

While completing my final gate (`git merge main`, per this session's
practice of syncing before landing), I hit a real conflict:
`specs/features/BL-1052-a-role-seat-can-be-staffed-by-qwen-code.feature` and
the BL-1053 sibling feature were **deleted on `main`**, not merely edited.
Reading why turned up two commits on local `main` — **not yet on
`origin/main`** — that were not visible from my QA branch until this merge:

- `7de931977` (23:27:53, coordinator): "Park BL-1052, BL-1053: operator
  reframe, human_approval pending, active -> paused." Its own
  `approval_context` states, verbatim: **"Any coder work already started
  against the qwen-code-only shape is out of date and must not continue
  under that contract."**
- `8accd9287` (23:35:11, specifier): "Drain local-model intake: reframe
  BL-1052/BL-1053, mint BL-1082." Retires both qwen-code-only feature files
  outright ("retired rather than reworded"), reframes BL-1052 to a
  model-generic "downloaded local model" seat (agent key `local-model`,
  `depends_on: [BL-1082]`), reframes BL-1053 to a model-generic routing
  ticket, and mints BL-1082 (pull-and-serve a named model, Ollama). Both
  reframed tickets are `human_approval: pending` — the widened scope has
  not yet been re-approved by the human, even though the ORIGINAL
  qwen-code-only tickets I hold had `human_approval: approved`.

**Timeline**: the coordinator parked the tickets on `main` at 23:27:53. The
hardener (23:29:35) and documenter (23:34:57) both committed AFTER that
instant, in their own worktrees, without having merged `main` recently
enough to see it — the exact race "Amending An In-Flight Ticket's Spec"
(BL-317/BL-325) describes. The parcel reached my inbox at 23:35:10, one
second before the specifier's own reframe commit. Nobody in the chain acted
in error; the amendment simply landed while the parcel was already in
flight, on a `main` ref my worktree had not yet re-synced with.

## Disposition

Per Article 4.4's spec-gap table and BL-317/BL-325 ("the specifier sends a
`note`... the receiver merges `main` first"): **this is not a bounce and not
an approval.** The implementation is not defective — it was built correctly
against a contract the specifier has since retired. Bouncing it to any
pipeline role would be wrong (there is no defect for that role to fix);
approving and landing it as "BL-1052"/"BL-1053" would be worse — those IDs
now name a materially different, not-yet-human-approved ticket on `main`,
and landing the old qwen-code-only work under them would corrupt both the
backlog record and the git history's meaning of those IDs.

**Not approved. Not forwarded. Not bounced.** I merged `main` into my QA
worktree (resolving the two feature-file conflicts by taking `main`'s
deletion — the specifier's own authority, not mine, retired them) and am
completing my inbound task without a forward, per Article 4.4: "When EVERY
item is a spec gap there is no parcel to bounce at all: send the note,
complete the inbound task, and do not forward."

The qwen-code-only implementation itself (`swarmforge/packs/qwen-code-mono-router.{conf,prompt}`,
`swarmforge/scripts/ancillary_provider_lib.sh` additions, the
`prompt_engine_lib.bb`/`swarmforge.sh` launch-adapter changes, both step
handlers, both property runners, both shell test suites) remains committed
in my QA worktree's history (reachable from this branch, not from `main`)
in case the specifier judges it reusable as BL-1052's own stated "first
quest, not the whole product" Qwen proof once the generic path exists — that
judgment is the specifier's, not mine. I have not deleted any of it and have
not pushed it to `origin/main`.

## For the specifier and coordinator

- Both reframed tickets (`backlog/paused/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.yaml`,
  `backlog/paused/BL-1053-the-intelligence-layer-can-route-work-to-a-local-model-seat.yaml`)
  are `human_approval: pending` — nothing for QA or any pipeline role to act
  on until the human re-approves the widened scope.
- If any hop still holds a parcel built against the retired qwen-code-only
  contract (I cannot see other worktrees' inboxes from here), it needs the
  same disposition this note gives mine.
- The hardener's own evidence file separately flagged a stray backlog
  duplicate (`backlog/paused/BL-1053-...yaml` alongside `backlog/active/`)
  from BEFORE this reframe — likely already moot now that both paths have
  been superseded by the reframe's own new files, but flagging in case it
  is not.

By QA.
