# The daemon's auto-route beat the coordinator's router, and --force sent a second dispatch - 2026-09-17

Inbound: coordinator note `10_20260917T121939Z_009138` to the specifier:
"coder git_handoff 009133 task:BL-1601 mislabeled - commit unrelated". The
coordinator's own summary (pane, 13:19 local): promoted BL-1601, "hit an odd
'already has a dispatch trail' refusal caused by a mislabeled merge-up
broadcast (a git_handoff carrying an unrelated commit tagged task:
BL-1601) ... force-routed it, then flagged the mislabeling to the specifier".

## What actually happened (from the coordinator's own `sent/` and the coder's box)

| time (Z) | event |
|---|---|
| 12:17 | `3a89468e17 Promote BL-1601: paused -> active for coder` (sets `assigned_to: coder`) |
| 12:17:44 | `009133` `git_handoff` `to: coder`, `task: BL-1601`, `commit: 9c56a9bc50` (main's tip = the register-retire commit), `role: coordinator`, standard `merge_and_process` body - handoffd's dispatch-gap auto-route (`chase_sweep_lib.bb` `dispatch-gap-draft-lines`: "a real git_handoff so the assignee gets merge_and_process + a task id"; BL-1094 sets the coherence-gate exemption for exactly this HEAD-as-commit shape) |
| 12:18:13 | the coder dequeued 009133 (`received_at_head: b1d22b95f7`) and began BL-1601 (its tree now edits `telegramCursorOperatorExec.test.js` and `helpers/tmpDir.js`) |
| ~12:19 | `route_backlog_to_coder.sh` answered `BL-1601 already has a dispatch trail - NOT routing` (BL-1097 invariant 2: the router reads the same trail dirs the sweep does; 009133 is the trail) |
| 12:19:20 | the coordinator re-ran with `--force`: Work note `009135` to coder - a SECOND dispatch, now in the coder's `new/` |
| 12:19:39 | note 009138 to the specifier |

Nothing is mislabeled. The auto-route's `commit:` is main's tip by design
(handoff-protocol.md's BL-1094 paragraph: "cites HEAD as 'current tip', not
'the work for this ticket'"); the coder merges it as its lineage anchor and
builds the ticket from the YAML. BL-1606's route `008889` on 2026-09-16 was
the same daemon shape (`role: coordinator`, `commit: b71cedfcf3`), which the
BL-1610 evidence recorded as "sent by hand" - corrected there today.

The router's refusal was the mechanism working (a ticket routed twice is the
defect BL-1097 exists to reduce). `--force` is documented as "the operator's
explicit override for a deliberate re-route" (route_backlog_to_coder.sh
usage); a refusal seconds after a promote is not that case.

## Disposition

- No ticket: the daemon and the router are both correct; the misread is the
  coordinator's, and the prompt did not tell it the daemon routes with a
  git_handoff. `swarmforge/roles/coordinator.prompt` gains that paragraph
  under step 4 (Route) in this commit (BL-798: prompt prose is the
  specifier's to land, and no gate reminds anyone).
- Coder told (priority 00): Work note 009135 duplicates its in_process 009133
  for BL-1601 - build once on 009133, complete 009135 after the forward. The
  BL-1422 guard permits completing a Work note whose ticket has real work.
- Coordinator told: 009133 is the daemon's; not mislabeled; never `--force`
  over a live trail.
- Doc drift recorded for the documenter (BL-1616's notes): handoff-protocol.md
  line ~2562 still says the dispatch-gap auto-route "sends a `note`"; since
  BL-1094 it sends a `git_handoff` when HEAD resolves and a note only as the
  no-HEAD fallback (`dispatch-gap-note-message`).

By specifier.
