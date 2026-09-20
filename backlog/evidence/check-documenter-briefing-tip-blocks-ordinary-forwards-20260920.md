# check_documenter_briefing_tip.sh blocks EVERY ordinary documenter→QA forward

Found attempting to merge documenter's ordinary BL-1656 forward
(`5681027848`, a routine `git_handoff` parcel — an ordinary pipeline
ticket, not a "land documenter briefing" request).

## Reproduction

```
$ git merge 5681027848a9486c4f89d38ded51a937e72467c9 --no-ff -m "Merge documenter ... into QA."
Merge refused: the documenter briefing tip 5681027848... carries content
outside its lane: [~70 unrelated pipeline paths listed]
A documenter briefing tip may carry only docs/briefings/<date>.md and its
own docs/briefings/<date>.json (same date), never docs/briefings/.sent.json.
pre-merge-commit: COMMIT REFUSED. Guards reporting a violation:
check_documenter_briefing_tip.sh
```

`git rev-parse swarmforge-documenter` == `5681027848a9486c4f89d38ded51a937e72467c9`
exactly — the commit being forwarded IS the documenter branch's current
tip, which is true of every ordinary forward (forwarding always happens
at the sender's current tip).

## Root cause

`swarmforge/scripts/check_documenter_briefing_tip.sh`'s hook mode (wired
into `swarmforge/git-hooks/pre-merge-commit`, runs on EVERY merge, not
just QA's deliberate "land documenter briefing" recipe) judges whenever
`INCOMING == the documenter branch's exact current tip` — a narrowing
already applied once today (commit `f46bd22ab1`, "hook mode judges only
the documenter branch's exact current tip, not any ancestor of it",
fixing a broader ancestor-based false-positive). That fix solved the
cross-merge false-positive it targeted but does not solve this one: it
still cannot distinguish "QA is deliberately landing a briefing tip" from
"QA is receiving an ordinary parcel forward that happens to be at
documenter's current tip" — which is the ONLY state a `git_handoff`
payload from documenter is ever in. There is no signal in the hook-mode
invocation (no flag, no env var, nothing in the merge commit message at
merge time) telling it which case applies, so it applies the narrow
briefing-only lane to both, refusing every ordinary forward whose diff
(the ENTIRE ticket's pipeline history, dozens of files) isn't a single
day's `docs/briefings/<date>.md` pair.

## Impact — swarm-wide blocking

Every future documenter→QA `git_handoff` merge will hit this identically:
the payload commit is always documenter's current tip by construction.
QA cannot receive ANY parcel from documenter until this is fixed. This is
more severe than a land-time escalation (which still lets QA verify and
hold): it blocks RECEIVING the work at all.

## What I did

Aborted the merge cleanly (`git merge --abort`, working tree clean, no
partial state left). Did not use `--no-verify` or otherwise bypass the
hook. BL-1656's parcel (documenter commit `5681027848`) is un-merged and
unverified, held pending this fix.

## Disposition

Not a defect in BL-1656 (nothing about its own content is wrong — the
guard refuses based on volume/shape of an ordinary ticket diff, not any
specific bad path). Escalating to the specifier at the highest priority:
this blocks the entire pipeline's documenter→QA step, not just one
ticket. Given `f46bd22ab1` shows the coder is already mid-iteration on
this same guard this session, this may already be in flight — reporting
regardless since it's new information (a different, still-unfixed false
positive) and swarm-wide blocking severity.

By QA.
