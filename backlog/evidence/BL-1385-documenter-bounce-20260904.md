# BL-1385 — documenter send-back (2026-09-04)

## What happened
While preparing the QA handoff, `swarm_handoff.sh`'s PRE_QA_GATE flagged
several BL-1385 commits stranded on other branches (`side`,
`swarmforge-architect`, `swarmforge-cleaner`, `swarmforge-hardender`) —
real bounce-fix work that never reached the commit (`87275f1666`) hardener
forwarded to documenter. Investigated rather than blindly recording them
under `abandoned_commits:`.

## The gap, verified directly
The specifier amended this ticket in flight (`cf2ea583c7`, landed on
`main`, "no new ticket — the parcel is in flight and the fix belongs in
it"): the cleaner reproduced two concurrent `check_handler_module_graph.sh`
invocations deleting each other's working tree (`rm -rf <prefix>.*` before
`mkdtemp`, sharing a fixed `PREFIX`), which false-refuses a correct commit
under normal pipeline concurrency. The amendment added invariant 3
("Concurrent invocations never interfere...") and acceptance scenario 10
("two invocations running at once each reach their own verdict") to the
ticket's own binding contract.

Merged `main` into the documenter worktree (`33452b74dc`) to pick up the
spec/feature amendment — but the CODE fix does not exist anywhere on the
line that reached documenter. Confirmed directly:
`swarmforge/scripts/check_handler_module_graph.sh` (current tip) still
has the unfixed line:

```
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
```

A real fix for this exact class (and a related resource-pressure
false-refusal in the same script — `fs.existsSync` answering false under
FD pressure, per `d72e13b93b`'s `existsOnTree` three-way check) already
exists, evidenced and reviewed, on the `side` branch (tip `839873ab82`,
"reaping is scoped to roots no live run owns (invariant 3, scenario 07)")
and its ancestry (`d72e13b93b`, `bf3c9f31ca`, cleaner/architect re-review
commits) — but that work was never sent forward as a git_handoff for
BL-1385; it appears to have continued on coder's own branch alongside
BL-1387 work after BL-1385 had already left coder's hands once.

## Why documenter cannot fix this
This is a production-code defect (documenter does not change production
code or tests — factual doc fixes only) and it is not documenter's call
which of the two existing fixes (or a synthesis) should ship, nor to merge
unreviewed branch content into the parcel on its own authority. Per
"Never Blind-Forward A Bounce You Cannot Fix": routing to the owning role
rather than absorbing or forwarding broken.

## Bounce
Blamed: coder (production-code gap against the ticket's own amended
acceptance criteria — invariant 3 / scenario 10 unimplemented in the
commit forwarded downstream). Class: behavior (missing implementation).
Not a second QA bounce — this is documenter's own send-time discovery,
before the parcel ever reached QA.

Recommended remedy for coder: reconcile `side`'s tip (`839873ab82`) — or
whichever of its fixes the coder judges correct/current — forward, and
re-run the full BL-1385 pipeline from coder; do not let BL-1387's
in-progress branch be the only place this fix lives.
