# BL-2107 coder review — stamp-off for hotfix 597801eadd

Reviewed, never re-applied. Hotfix already on main (597801eadd), present
unchanged in `specs/pipeline/steps/bl1700StewardCoderProbeSteps.js`
(`probeProcessLines`/`pidOfPsLine`, the pid snapshot in scenario 03's first
`Given`, the filtered leak check).

## What the hotfix does

Scenario 03's leak check used to scan `ps aux` host-wide for any process
matching `.probe.tmux.sock` or `stand-in.sh` and fail on any match. That
counted real, unrelated steward probes already running on the host
(`model_steward_cli.bb probe --prepare`) as leaks from this scenario. The
fix snapshots the pids of every matching process in the scenario's own
`Given` step, before the run starts, and the leak check now fails only on
a matching pid NOT in that snapshot — i.e. one that appeared during this
scenario's own run.

## Verification

`node specs/pipeline/cli.js specs/features/BL-1700-the-model-steward-probes-a-local-coder-model-through-the-real-driver.feature`:
**7 of 7 ok** (this host has no live steward probe running right now, so
this run does not reproduce the original 6/7 failure mode directly, but it
confirms the hotfix introduces no regression on a clean host and the
snapshot/filter mechanism runs without error).

## Review question (from the ticket): can a NEW unrelated process still false-positive?

Yes, in principle: the snapshot is taken once, in the scenario's first
`Given` step, and the leak check only excludes pids present in that
snapshot. A process matching `.probe.tmux.sock` or `stand-in.sh` that
starts *after* the snapshot but *during* this scenario's own short,
wall-clock-capped run — a steward probe someone else starts on the same
host in that window, or a concurrent BL-1700 acceptance run in another
worktree — would still be counted as a leak, because the filter has no way
to tell "started by a concurrent run" from "started by this scenario and
never cleaned up".

Judgment: not worth a follow-up ticket. The window is the scenario's own
wall-clock cap (seconds), the failure mode is a flake (a false red, never
a false green — a real leak from THIS run is still caught), and a tighter
fix would need a marker threaded through `model_steward_cli.bb`'s own
tmux/session naming (out of this ticket's and this hotfix's scope: BL-1700
owns that contract, BL-1251) rather than anything fixable from the step
handler alone. This is a strict improvement over the pre-hotfix state
(which failed on ANY pre-existing probe, not just a same-window new one),
and the residual risk is narrow enough to leave as an accepted flake shape
rather than mint more work against it.

No production code changed by this ticket; the parcel is this review plus
the verification run above.
