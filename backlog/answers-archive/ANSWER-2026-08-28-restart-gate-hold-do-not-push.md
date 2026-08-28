# Answer — restart-gate push window (2026-08-28, asked via role_ask; answered 10:54Z)

Question raised to the human at the BL-1191 pre-restart gate, with the swarm
**down** and a restart the next action:

> local `main` is 53 commits ahead of `origin/main` and 0 behind, and TWO of
> them hold the only copy of product code — `swarmforge/scripts/model_factory_lib.bb`
> (+17 −3) and `test/model_factory_test_runner.bb` (+9), commits `869f17d01` /
> `ece95af58` from 07:33 BST today. BL-1214's reset discards exactly the ahead
> set and BL-1236 pins its trigger to ordinary backlog prose, so a restart now
> risks all 53. A push is a pure fast-forward (origin is 0 ahead) and destroys
> nothing, but pushing `main` is not the specifier's role and cannot be scoped
> to just my spec commits — it carries the two product commits too.

Four options were offered: specifier pushes / human pushes / restart without
pushing / hold and wait for QA.

**Human: "Hold restart, do not push, wait for QA."**

Recorded verbatim in `.swarmforge/operator/role-answers/specifier.json`:

> Hold restart, do not push, wait for QA

## Disposition

- **The restart stays blocked.** This is now blocked twice over, for two
  independent reasons: the original BL-1191 cleanup hold
  (`.swarmforge/operator/INTAKE-bl1191-pilot-cleanup-gate-before-restart.md`,
  not discharged) and this answer.
- **Nobody pushes `main` outside QA.** The specifier's push option is closed;
  do not re-raise it. The two ModelFactory commits stay unpushed until QA lands
  them through its own path.
- **The specifier's single `role_ask` slot is free again.**
- The gate reading is unchanged at the time of writing (`53 0`, same two
  product files). Re-derive at gate time regardless — the count has moved
  0 → 9 → 1 → 12 → 0 → 36 → 53 across three days.

## The ordering constraint this creates — flagged, not re-litigated

"Hold restart" and "wait for QA" are both satisfiable, but not by waiting
passively: **QA is a swarm role, and the swarm is down.** A plain restart to
bring QA up is the very event that endangers the 53 ahead commits, so waiting
for QA-via-restart would spend the risk this answer was given to avoid.

The path that satisfies both already exists and needs no restart:
`swarmforge/scripts/expedite.sh` walks one ticket through the same role hats
and gates **with the stack stopped**, reading only durable git data (BL-567).
That is the mechanism by which QA can land and push those two commits without
the restart this answer holds.

This is recorded as a fact about sequencing, not as a request to revisit the
decision. The decision stands as given.

## Still open, deliberately

- **BL-1198** — main rematch reset must attempt push before discarding local
  ahead commits. Active.
- **BL-1214** — the reset itself (defect/critical, approved, blocked on BL-1198).
- **BL-1236** — `merge-tree-reports-conflict?` greps the content diff for the
  word "CONFLICT", so ordinary backlog prose triggers it (defect/critical,
  paused, `human_approval: pending`). This is the pinned cause of the 10th
  reset occurrence.

None of these needs a new ticket; this answer changes none of their ownership.

---

## Record repair, 2026-08-28 (specifier)

This file was lost from `main`: it landed as commit `5ca4950d6`, which the
subsequent reset of `main` to `origin/main` discarded
(`git merge-base --is-ancestor 5ca4950d6 main` -> false; the object survives
only because nothing has gc'd it). Restored verbatim with
`git checkout 5ca4950d6 -- <path>`; nothing above this line was edited.

Two consequences worth recording, because the second one blocked a different
role's work hours later:

1. The answer above never reached the pending marker.
   `.swarmforge/operator/role-awaiting/specifier.json` is written by
   `role_ask.bb` and cleared by exactly one writer — `clearRoleAwaitingAnswer`
   in `extension/src/tools/telegram-front-desk-bot.ts`, which fires when the
   front-desk bot captures an answer. The swarm was DOWN when the human
   answered, so no bot ran and the marker stayed. The single-pending guard
   then refused every later specifier question
   (`{"asked":false,"reason":"already-pending"}`) with no expiry and no
   override — an answered question holding the slot shut indefinitely.
2. Cleared by hand on 2026-08-28 after verifying the answer above is recorded,
   archiving the marker to
   `.swarmforge/operator/role-awaiting-archive/specifier-20260828-answered.json`
   rather than deleting it (out of the `role-awaiting/` directory that
   `operator_runtime.bb` scans for `*.json`, so the archived copy can never be
   read back as live state).
