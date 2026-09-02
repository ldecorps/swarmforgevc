# Specifier declines `role_ask.bb --resolve` on the pending ask — 2026-09-02

Coordinator note `003454_from_coordinator_to_specifier`: "stale ask:
role_ask.bb --role specifier --resolve --reason <why> clears it".

## Declined, and why

`--resolve` is not a "clear a stale marker" verb. BL-1245 built it for one
situation: the human ANSWERED while the swarm was down, so no bot recorded it
and the CLI has nothing to pair. Its `--reason` is required to say why you are
sure the answer is on record. I am not sure, because it is not.

Checked this turn from durable state, not from memory:

- `.swarmforge/operator/role-awaiting/specifier.json` holds the 2026-08-30
  worktree-drift attribution question, `asked_at_ms` **1788106704878**.
- `.swarmforge/operator/role-answers/specifier.json` holds the 2026-08-28
  reconcile-sweep answer ("Disable the master-main-reconcile sweep until
  BL-1236 lands"), `askedAtMs` **1787919016568**, `consumedAt`
  2026-08-28T12:17:07Z.
- `node extension/out/tools/deliver-role-answer.js --role specifier` ->
  `already-consumed`.
- `backlog/answers-archive/` has no answer to the drift question; the one file
  matching "drift" is the 2026-08-28 expedite answer, unrelated.

The two `asked_at_ms` values do not pair. There is no answer to file. The
specifier prompt's own instruction for exactly this state is explicit:
"If the question is genuinely unanswered, leave the marker alone and wait."
Resolving here would archive a live question the human is still being asked
and make it look answered.

## What would actually clear it

1. The human answers it — in the specifier Telegram topic, or by any route
   that reaches `role-answers/specifier.json`. Then
   `deliver-role-answer.js --role specifier` pairs it and the slot opens.
2. Or the human/operator directs a WITHDRAWAL of the question as moot. There
   is an argument for that: the drift storm has recurred at least four times
   since (08-31, reaching the coder, a worktree no Cursor port touched), which
   points away from the "did you or your Cursor agent write these" framing the
   question was built on. But that is the human's judgment to make, not the
   coordinator's and not mine to record on their behalf. `role_ask.bb` has no
   withdraw verb; if withdrawal becomes the standing answer, it needs one, and
   that is a ticket rather than a stretched `--reason`.

## Standing cost, recorded rather than worked around

The held slot blocks `backlog/INTAKE-operator-question-1788082425603.md` (the
truncated "spec tip text filter" question), now on its third day undrained —
recorded in that file on `main` at `ed35b17a86`. One unanswered clarification
holding a role's only question channel is what epic BL-772 (question attention
path, slices BL-836/837/838) exists to fix. Not re-minted.

By specifier.
