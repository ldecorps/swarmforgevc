# INTAKE — Open-slot nudge escalates on `type: epic` trackers (BL-545 forever)

**Source:** human via Cursor / Operator Telegram, 2026-08-25 ~21:03 BST  
**Priority:** queue-jump — open slot stays empty; escalation is noise  
**Status:** new intake, not minted.

## Why this is in front of you

Operator alert (verbatim):

> ⚠️ Open slot unfilled through 3 nudges — top candidate `BL-545` still not promoted.

Measured same evening on this checkout (`active=2`, `cap=5`, slot open):

1. `chase_sweep_lib/nudge-eligible-candidates` + `top-open-slot-candidate`
   name **BL-545** (priority 30 epic tracker
   `backlog/paused/BL-545-epic-swarm-intelligence-layer.yaml`).
2. `promotion_gates_lib/evaluate` returns `{:ok true}` for that YAML —
   **no epic gate** in the evaluate chain.
3. `./swarmforge/scripts/promote_and_route_next.sh BL-545` correctly
   refuses: `Error: BL-545 is epic or blocked` (`is_epic_type`).
4. `--list-candidates` skips epics (`skip BL-1013 gate=epic`, …) and
   returns real tickets (BL-1000, …).

So the open-slot nudge/escalation path (BL-798 / BL-963) names a candidate
the sanctioned promote path **can never promote**. After 3 identical
nudges, BL-798 escalates once and then goes quiet for that same candidate —
the slot stays open forever while the real top non-epic sits ignored.

## Root cause (not speculation)

BL-1100 deleted the prose `do[- ]not[- ]promote` grep and kept epic
exclusion only in `promote_and_route_next.sh` (`is_epic_type` /
`announce_skip … gate=epic`). Spec / ticket claim candidacy uses
`type: epic` + gates — but **open-slot eligibility never consulted that
shell filter**. It only runs `promotion_gates_lib/evaluate`, which has no
`type: epic` refusal.

BL-545's own notes say "NOT directly promotable — the coordinator promotes
CHILD slices, never this." That prose is no longer a bar (correct per
BL-1100); the structured `type: epic` bar must apply on **every**
candidacy surface, including the nudge.

## Goal

One ticket: open-slot nudge / escalation / fire decision must use the
**same non-epic candidate set** as `promote_and_route_next.sh` auto-pick.

Preferred shape (specifier locks one; do not invent a second parallel
rule):

1. Add a `type: epic` (and ideally `status: blocked`) refusal to
   `promotion_gates_lib/evaluate` so every consumer of the chain inherits
   it (BL-663: one chain), **or**
2. Filter `nudge-eligible-candidates` with the same structured epic/blocked
   predicates promote uses, with a shared helper so the shell and bb
   cannot drift.

Acceptance must show:

- A paused `type: epic` is never named as open-slot top candidate, never
  accrues nudge/escalation count, and never alone keeps `decide-open-slot-
  nudge?` true when only epics remain eligible.
- A real non-epic that would win Article-3.2.4 among promote-eligible
  paused tickets is named instead (fixture with epic pri=1 and feature
  pri=2 → feature wins the nudge).
- Explicit `promote <epic-id>` still refuses with an epic gate (no
  regression of promote_and_route).
- Residual race: after the fix, today's BL-545 escalation state clears on
  next different top candidate (existing BL-798 reset) — no ops required
  beyond deploying the filter.

## Locked human decisions

1. Do **not** promote BL-545 (or any `type: epic`) to "fix" the alert.
2. Residual of BL-1100 / BL-798 / BL-963 — new id; do not reopen those.
3. Prefer queue-jump once minted — this blocks filling open slots whenever
   an epic ranks above real work (BL-545 priority 30 is enough to win).

## Out of scope

- Minting or promoting BL-545 children / remaining_slices
- Changing Article-3.2.4 / BL-900 ranking among real tickets
- Silencing the escalation channel without fixing candidacy
- The frequent QA push-race intake (separate file)

## Related

- Live: Operator Telegram open-slot escalation; `active=2` `cap=5`
- `swarmforge/scripts/chase_sweep_lib.bb` (`nudge-eligible-candidates`,
  `top-open-slot-candidate`, `open-slot-escalation-telegram-text`)
- `swarmforge/scripts/handoffd.bb` (`open-slot-nudge-sweep!`)
- `swarmforge/scripts/promote_and_route_next.sh` (`is_epic_type`,
  `announce_skip … gate=epic`)
- `swarmforge/scripts/promotion_gates_lib.bb` (`evaluate` — missing epic)
- Done: BL-1100, BL-798, BL-963, BL-900
- Tracker named tonight: `backlog/paused/BL-545-epic-swarm-intelligence-layer.yaml`

## Acceptance sketch

1. Spec + feature: epic tracker never open-slot-eligible; blocked same if
   promote already skips it; non-epic wins nudge when both present.
2. Property or APS covers the BL-545 shape (paused epic, open slot,
   otherwise-empty or lower-ranked real ticket).
3. How-to / Spec note: open-slot candidacy ≡ promote auto-pick candidacy
   for epic/blocked (one chain or shared helper).
4. Drain this intake when minted.
