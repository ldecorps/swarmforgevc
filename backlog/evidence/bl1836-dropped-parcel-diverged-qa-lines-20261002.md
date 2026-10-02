# BL-1836 dropped-parcel investigation (coordinator, 2026-10-02)

Dropped-parcel sweep flagged BL-1836: no live parcel in any role's mailbox,
ticket still `status: todo, assigned_to: coder` in `backlog/active/`.

## What happened

QA's worktree branch does not keep one linear history per ticket — per
BL-1871, a role's `ready_for_next` takes up each new parcel on that
parcel's own commit line rather than merging into one long-lived branch.
BL-1836's QA review therefore has TWO diverged outcomes, neither reachable
from the other:

- **`838d643744`** — "QA review pass evidence (1 defect(s))", reachable
  from QA's current HEAD. The one defect: `confirmPoleAloneOutcomeShapes.test.js`
  over its 7.0s per-file budget — an **unowned red**, blamed role "none",
  remediation pointer "specifier mints an owner". This is exactly the red
  the specifier minted **BL-1893** for, hotfixed as **`8ed4173ce4`**
  (already on main, already waived under Article 4.2 by the coordinator).
- **`f1cb7ecbf1`** — "QA review pass evidence (NONE)", on an abandoned
  line, NOT reachable from QA's current HEAD. Its parent chain shows QA
  merged main (which by then carried the BL-1893 hotfix) and re-ran clean.

So `f1cb7ecbf1` looks like the correct, later continuation of
`838d643744` — the same defect, now fixed upstream — but it sits on a
branch line QA's worktree has since moved off of (onto BL-1887, then
BL-1892's lines), so nothing ever forwarded or landed it.

## Why the coordinator did not just forward it

`swarm_handoff.sh`'s PRE_QA_GATE refused a `git_handoff` naming `f1cb7ecbf1`:
forwarding it would strand `838d643744` (not its ancestor) on
`swarmforge-QA`, `swarmforge-documenter` and `swarmforge-hardender` — the
gate cannot itself know that the stranded defect is the same already-fixed
unowned red, and the coordinator does not judge that call either
(Article 4.4 / BL-425: never blind-forward or silently resolve a bounce
you cannot adjudicate).

## What is needed

Specifier adjudication: confirm `f1cb7ecbf1` is the right commit to
resume BL-1836 from (or name a different one), and either record
`838d643744` under `abandoned_commits:` on the ticket (so the gate's
ancestry check stops flagging it) or direct a fresh re-review on the
current line. Once resolved, the coordinator will send the `git_handoff`
to QA.
