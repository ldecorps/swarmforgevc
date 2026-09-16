# Coder unowned-red note on BL-1185 (seat-claim NO_TASK, raised from the BL-1602 sweep) - specifier adjudication (2026-09-16 19:55Z)

Inbound: `00_20260916T182510Z_002003_from_coder_to_specifier_coordinator`,
"unowned-red: BL-1185 seat-claim NO_TASK, unrelated to audit fix (BL-1602)".
Coder evidence: `.worktrees/coder/backlog/evidence/BL-1602-coder-20260916.md`,
"BL-1185 note". Outcome: **BL-1608** minted; BL-1185's register row moved
from BL-1602 to BL-1608; BL-1602 amended in flight.

## Reproduction on main (specifier, 19:40Z)

`./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1185-work-note-missing-task-header-defers-hard-seat.feature`
at main 1ec0e88700: 37 s, 3 pass, 1 fail:

```
not ok 2 - the hard seat claims an ambulance patient Work note when easy is idle
Scenario "..." failed at step "Then the Work note is claimed rather than skipped as defer-better-fit": hard should claim Work note; out=NO_TASK
 err=backlog_depth_lib: no swarm-identity for /tmp/bl1185-acc-CEudai/coder/.. - falling back to the tracked default conf ...
 new=10_work_1789583561812.handoff in_process=
```

(The stderr line is BL-966's loud fallback in a fixture with no
swarm-identity, expected; the conf it falls back to is the fixture's own,
with the two `--seat-tier` windows.)

## Mechanism (read, not guessed)

- `difficulty-allows-claim?` (`ready_for_next_task.bb:92-108`):
  `cost (mutation-cost-for-task (handoff-lib/header-field handoff-file "task"))`.
  A Work note has no `task:` header (git_handoff-only), so cost is nil and
  `difficulty-claim-decision` on the hard seat with an idle easy sibling
  answers defer-better-fit -> NO_TASK, note left in `new/`. Exactly the
  fault BL-1185 fixed.
- `git log -S'task-name-from-content' -- swarmforge/scripts/ready_for_next_task.bb`:
  8fa2a5c2fb (BL-1185, 2026-08-27) added `task-name-for-difficulty`
  (header, else `supersede-lib/task-name-from-content` on the note);
  93cda4ca37 and 465281d90d (BL-1167 branch, "keep BL-1185 attribution");
  ccc63d8cfd (BL-1167's land, 2026-08-27 15:31) REMOVES the function and
  puts the bare header read back - the diff hunk is unambiguous. A landed
  fix silently reverted by the next land (BL-571/BL-958 class), twenty
  days ago; nothing runs the acceptance corpus routinely, so BL-1185's
  scenario 02 was first recorded red today (specifier census, then the
  coder's sweep).
- `apply-effort-for-task!` (line 65, BL-1316) reads the same bare header
  at the claim moment: a claimed Work note applies no ticket effort either.
  Lines 229 and 359 feed the rework-claim decision (BL-1004, git_handoff
  parcels) and are not cost readers.
- Not the audit class: the driver's own sends are `type: note`; the coder
  re-ran before and after the helper change, same single failure.

## Outcome

- **BL-1608** (`type: defect`, `severity: high`, epic multi-seat-stages):
  one shared `claim-task-name` (header, else Work message, else nil) used
  by both claim-time cost readers; source census pins exactly two call
  sites and no bare header read for a cost; BL-1185's feature green is the
  e2e and the row's release.
- Register: BL-1185's row re-pointed BL-1602 -> BL-1608 (first_seen
  2026-09-16 unchanged; note records "red since 2026-08-27"). Register
  still 15 rows, all owned.
- BL-1602 (active, coder stage) amended in the YAML only: the row table
  entry and a notes paragraph - nine rows leave with its land, the BL-1608
  row stays (BL-1604's replay hazard named); scenario 03's "green" for
  BL-1185 reads as green for the audit class, which the coder's handler
  already encodes as "green (audit)". No feature text changed, so no
  handler churn. Coder sent the merge-and-re-read note.

## Recorded, not ticketed

- Twenty days between a silent revert and its first record, on a feature
  that exists to gate exactly this. The BL-1602 adjudication already
  records that nothing runs the acceptance corpus routinely; this is the
  second consequence of that in one day. Ceremony-packet material.
- A land that rewrites a function's signature is where a sibling's
  hitchhiking fix goes missing: 465281d90d said "keep BL-1185 attribution"
  and the very next commit dropped it. Diff every land against BOTH
  parents (engineering.prompt Guardrails) would have shown the removed
  `task-name-for-difficulty`.
