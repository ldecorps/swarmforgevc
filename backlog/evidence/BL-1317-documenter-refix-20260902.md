# BL-1317 — documenter pass (round 2, post-bounce), 20260902

Received: hardener commit `093322324e` (BL-1317: hardener pass 2 - close a
reason-string mutation gap in the sole remaining (bb) implementation),
forwarded from architect's re-pass `84606ec162` on top of cleaner's
`420a30bd31` and coder's required_wiring amendment (`e1f58e1dbb` +
`00cc6872eb`).

## Bounce inventory travels (Article 4.4)

The one prior bounce (`backlog/evidence/BL-1317-qa-bounce-20260902.md`,
D1, blamed `coder`): `required_wiring` item 1 named a TypeScript-side
caller (`extension/src/tools/effortDialAdapt.ts::decideAdaptEffort`,
"UI and launch paths call it") that could not exist — the adapt moment is
entirely on the Babashka side, so no TS caller was ever addable.

**Resolution, verified not merely claimed:** coder amended
`required_wiring` on the ticket YAML to drop the TS-caller claim and
anchor wiring to the pre-existing live `done_with_current_task.bb` caller
instead (bb-only), and deleted the dead `effortDialAdapt.ts` module and
its test. Confirmed:

- `extension/src/tools/effortDialAdapt.ts` and
  `extension/test/effortDialAdapt.test.js` are gone (`ls` — no such
  file).
- `grep -rn "effortDialAdapt" docs/` — no reference anywhere in `docs/`.
- `required_wiring` on `backlog/active/BL-1317-...yaml` now names only
  `seat_difficulty_lib.bb::adapt-effort-decision`,
  `handoff_lib.bb::record-effort-adapt!`, and
  `done_with_current_task.bb::record-effort-adapt!` as the anchor.
- New guard test `extension/test/bl1317AdaptSingleApplierPerLanguage.test.js`
  enforces exactly one applier per language going forward.

D1 is closed — no open item remains blamed on documenter or any other
role for this ticket.

## Review inventory

- Re-read `docs/how-to/BL-1317-adapt-tier-effort-from-outcome-signals.md`
  end to end against the amended shape: it already states plainly "there
  is no caller at the adapt moment for a TypeScript copy to serve" —
  correctly describes the bb-only wiring, no stale TS-caller claim.
  Written correctly during the first documenter pass, no change needed.
- Re-read `docs/reference/Specification.MD`'s BL-1317 paragraph: already
  says "so no TypeScript caller exists at the adapt moment" — consistent
  with the amendment. No change needed.
- Grepped both docs for `effortDialAdapt`/`decideAdaptEffort`/
  `adaptRoleEffort` — no hits. No dangling reference to the deleted
  module.
- Diagram registry (four `DIAGRAM_FILES` triggers): none fired — this
  round only narrows `required_wiring` and closes a mutation gap in
  `seat_difficulty_lib.bb`'s reason strings; no pipeline topology,
  handoff lifecycle, extension-host/webview boundary, or front-desk
  change. No diagram touched.

## Merge note (unrelated to this ticket's own content)

This merge's diff also carried `backlog/paused/BL-1056-a-...yaml` and
`backlog/paused/BL-1338-a-...yaml` deletions, flagged by the merge-
deletion guard. Verified before merging: both tickets are already live at
`backlog/active/` in this worktree (promoted in this session's own earlier
merges) — not a content loss, the guard's predicate is blind to the
incoming side reconciling against an already-promoted paused/ copy (known
false-positive class, BL-1341, not re-minted). Recorded in the merge
commit message per the guard's own confirmation requirement.

## Verdict

NONE — no documenter-domain defect, no doc change warranted this round;
documentation already matched the amended (bb-only) shape from the first
pass. Forwarding the received commit `093322324e` unchanged (via this
evidence-recording merge commit).

By documenter.
