# A role holding long-lived background shells is PERMANENTLY "busy" — and so can never be woken

Coordinator, 2026-08-20 ~04:00Z, from a babysitter "in_process parcel older than 30m
(age=70m)" alert on BL-910 at QA. **This is a real stall with a real mechanism defect
behind it, not a false positive.** (The same alert at age=31m WAS a false positive —
see below; the difference is measurable.)

## The stall
- QA holds `BL-910` in `in_process`, age 70m.
- Its property suite **finished**: `tmp/qa-props-910.log` last written 03:56Z, tail reads
  `Duration 2163.45s` (a completed 36-minute run). Zero growth on resample.
- QA's agent is **idle at an empty prompt**. Its newest child shell is **66 minutes old**
  and unchanged across samples — it has spawned nothing since.
- At age=31m the same parcel looked identical in the pane but its newest child was
  **1 second** old. So "newest child age" cleanly separates working from stalled;
  pane rendering does not.

## The mechanism defect
Delivering a wake note produced:

    HANDOFF DELIVER: deliver-notify-skip-busy QA swarmforge-QA
    HANDOFF DELIVERED: ...

The parcel **landed**, but the **wake was skipped as "busy"**. QA is not busy — it is idle
with 5 lingering background shells (a `caffeinate`, and shells 3-4 hours old). Busy
detection reads those shells as activity, so:

> a role that ever leaves a long-lived background shell behind becomes permanently
> "busy" to the chaser, and can never be woken again — while looking perfectly healthy.

This is exactly what handoffd was logging repeatedly right before it stalled:
`chase-wake-skip-busy QA`, three times in one second. So QA has likely been unwakeable
for hours, and the handoffd stall merely removed the last thing that might have retried.

## Why the coordinator did not force it
The supported wake path is what just skipped. `babysitter_enqueue_wake.sh` wakes the
Babysitter runtime, not a role pane. The remaining option is a direct `tmux send-keys`
into another agent's session — which would mean typing a command into QA's prompt on its
behalf. That is a step beyond routing and is being surfaced for a human decision rather
than taken unilaterally. The note IS delivered; QA will act on it the moment it takes any
turn.

## Needs a ticket (mint by specifier)
Busy-detection must distinguish "the agent is mid-turn" from "the agent is idle but has
background shells". Candidate signal: the pane's foreground/agent state, not the presence
of child processes. Until then, any role that backgrounds a long run is one skipped wake
away from an indefinite stall.

## Second role now accumulating the same condition (hardener, 05:58Z)

Investigating a "BL-967 batch claim stale 22m" alert, the hardener was found **idle at a
prompt** with **three leaked `tail -f` processes** (ages 32m, 30m, 12m) following
`tmp/bl967-acc.log`, `tmp/bl967-mutsweep.log`, `tmp/bl967-sweep2.log`.

It is genuinely working — `bl967-sweep2.log` grew 24 -> 106 bytes in a 6s resample and
two stryker/vitest processes are live — so the alert itself was a false positive. But
**two of the three tails follow runs that already finished** (acc last written 05:36,
mutsweep 05:51). `tail -f` never exits, so those shells persist for the rest of the
session doing nothing.

That is precisely the input this defect keys on. The hardener has now manufactured the
same permanent-"busy" state that left QA unwakeable for 70 minutes tonight, and will
keep it until its pane is respawned. Two of eight roles are now affected by the same
mechanism, from unrelated causes (QA: stale shells from a long gate; hardener: leaked
log followers).

Reinforces BL-970's severity: this is not a rare shape. Any role that watches a
background run with `tail -f` acquires it, and nothing cleans it up.
