# BL-998 — coder findings

The ticket's five are real and are fixed. Three things it did not have, one of
which contradicts a stated constraint — so it is raised here rather than
quietly acted on.

- **Author**: coder, 2026-08-21.

## The guard independently reproduced the count of five

Before touching any test, the derived guard named exactly:

```
test_compliance_battery_cli.sh:$READY_FOR_NEXT -> ready_for_next.bb
test_compliance_battery_cli.sh:$DONE_WITH_CURRENT -> done_with_current.bb
test_dispatch_lib_receive_mode.sh:$READY_DISPATCH -> ready_for_next.bb
test_dispatch_lib_receive_mode.sh:$DONE_DISPATCH -> done_with_current.bb
test_handoff_state_dir_worktree_root.sh:$READY_DISPATCH -> ready_for_next.bb
test_idle_clear_respawn.sh:$READY_TASK -> ready_for_next_task.sh
test_reference_freshness_guard.sh:$READY -> ready_for_next.bb
```

Five files, no misses, no false positives — arrived at from the code rather
than from the ticket's list. Getting there took two corrections worth
recording, both of them the traps the ticket's own notes describe:

- **Counting mentions, not call sites.** The first derivation called
  `batch_claim_progress_cli.bb` self-rooting because a COMMENT in it explains
  that its `.sh` sibling's `cd "$SCRIPT_DIR"` is unsafe. Whole-line comments
  are stripped before anything is decided now.
- **Reference is not execution.** The first offender scan flagged
  `test_ready_for_next_no_promotion.sh` — the file that already carries the
  fix — because it `grep`s its own dispatcher for a symbol. The variable must
  appear in COMMAND position, after env assignments and an optional `bb`.

## Finding 1 — a SIXTH offender, in the acceptance layer

`specs/pipeline/steps/readyForNextPromotionSteps.js` has the identical defect:
it builds a fixture worktree, queues `50_item1.handoff` into it, then runs the
REAL `swarmforge/scripts/ready_for_next.bb` with `cwd` set to the fixture and
no scripts installed.

**The proof is conclusive and needed no risky experiment**: the scenario
returned `NO_TASK` while its own fixture held a queued parcel. It was never
reading its fixture. `specs/features/BL-226-...feature` was **1 pass / 2 fail**
and is **3/3** with the same install-the-scripts fix — it was red *because* it
dispatched into this checkout, which happens to have no queued task right now.

This is worse than the shell cases in one respect: it is in the acceptance
pipeline QA runs. The guard as written scans `swarmforge/scripts/test/*.sh` and
would not have caught it; I found it by following the failure. **Whether the
guard should also inspect `specs/pipeline/steps/*.js` is a real decision and I
have not taken it** — it is beyond "five shell tests", and BL-974 is already
slated to share a home with this guard.

## Finding 2 — a stated constraint is contradicted by observed behaviour

The ticket says: *"`test_handoff_state_dir_worktree_root.sh` must keep its
lines 86 and 94."* Line 94 was `bb "$READY_BATCH"` — the real
`ready_for_next_batch.bb`. Running the otherwise-fixed test, that call
**read the live mailbox of the running coder** and printed:

```
TASK_IN_PROCESS_IS_SINGLE: use ready_for_next.sh or done_with_current.sh.
- /Users/ldecorps/projects/swarmforgevc/.worktrees/coder/.swarmforge/handoffs/
    inbox/in_process/10_20260821T104403Z_000761_from_coordinator_to_coder_for_coder.handoff
```

That is this parcel's own handoff. Nothing was claimed — but only because an
in_process parcel was already held, so the helper refused. Had the seat been
idle, the queued parcel in `inbox/new/` was claimable.

I converted the batch pair to the fixture copy and the test now passes 7/7.
**The two leaves the ticket names by name — `ready_for_next_task.bb` and
`done_with_current_task.bb` — are untouched at lines 19-20**, as required; only
`*_batch.bb`, which the ticket does not name, changed.

**Mechanism not fully explained, and I will not claim it is.** Run in isolation
from a scratch fixture, `ready_for_next_batch.bb` resolves the fixture
correctly (it creates the fixture's own mailbox dirs and reports `NO_TASK`). A
hypothesis worth the architect's eye: `done_with_current_task.bb:14` does
`process/exec (fs/path script-dir "ready_for_next_task.sh")`, replacing the
process image with a `.sh` wrapper **from its own script-dir** — which would
make "leaf" helpers transitively self-rooting whenever that branch is taken.
If that is the mechanism, the guard's signature should widen to follow
`process/exec` of siblings, and the leaf exemption needs re-stating.

## Finding 3 — one pre-existing failure, verified not mine

`test_idle_clear_respawn.sh` fails at check 01 ("expected a respawn-pane call
for the enabled role"), unrelated to dispatch isolation. Verified by restoring
the file to `HEAD` and re-running: **byte-identical pass/fail lines**. Its
BL-998 offence (the `ready_for_next_task.sh` wrapper) is fixed and the guard is
green on it; this failure is someone else's and is left alone.

## Safety: the reproduction step was NOT run against the live tree

`qa_e2e` step 2 asks for the theft to be demonstrated, and allows a clone if
one is unwilling to run it live. My `inbox/new/` held a real queued parcel for
the whole session, so running an unfixed test here could have claimed it. Every
demonstration above used a synthetic stand-in repo under a temp dir — including
the acceptance, whose "real repo" is a second fixture, never this checkout. The
one time a live mailbox was read was the accident described in Finding 2, and
it is reported rather than repeated.

## Verification

| check | result |
|---|---|
| the guard, before any fix | names exactly the five, 7 call sites |
| the guard, after | PASS |
| `test_dispatch_lib_receive_mode.sh` | 5/5 |
| `test_compliance_battery_cli.sh` | 8/8 (**was failing at HEAD** — "ready_for_next.sh was never actually run") |
| `test_handoff_state_dir_worktree_root.sh` | 7/7 |
| `test_reference_freshness_guard.sh` | 4/4 |
| `test_idle_clear_respawn.sh` | pre-existing check-01 failure, identical at HEAD |
| `specs/features/BL-226-...feature` | **1/3 → 3/3** |
| BL-998 acceptance | **5/5**, handler registered (`required_wiring` literal `bl998` present) |

**Declared invariants (BL-654).** Invariant 2 ("membership by inspection, never
a roster") is a property runner,
`swarmforge/scripts/test/bl998_guard_membership_property_runner.bb`, quantifying
over the axes a regex inspector actually breaks on — variable name, which
helper, executed vs merely read, real-dir vs fixture-copy anchor — with the
FILE NAME randomised every run, which no roster can satisfy. All eight
(kind × anchor × executed) combinations have asserted reachability floors.
Non-vacuity shown by replacing the derivation with a hardcoded roster of
today's five filenames: fails immediately, every generated offender unflagged.

Invariant 1 ("no test run alters live swarm state") is encoded by acceptance
scenarios 01 and 02 rather than a property: they fingerprint the stand-in real
repo's whole mailbox tree — names AND bytes — before and after a fixture
dispatch, and assert byte-identity. A property quantifying over "a test run"
against genuinely live state would have to run suites at the real tree, which
is the hazard itself.
