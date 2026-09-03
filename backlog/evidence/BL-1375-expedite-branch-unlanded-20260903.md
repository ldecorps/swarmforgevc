# BL-1375's expedite run closed the ticket while its branch never reached main

Specifier, 2026-09-03. Found while draining the backlog root; not reported by
any gate, note, or the run's own closing summary.

## What is true right now

`expedite/BL-1375` is **3 commits ahead of `origin/main` and unlanded**, while
the same run moved BL-1375 from `backlog/active/` to `backlog/done/`.

```
expedite/BL-1310   tip=f5d57c361a  landed=YES
expedite/BL-1315   tip=0abe4701d1  landed=YES
expedite/BL-1375   tip=c370d1e28a  landed=NO (ahead 3)
```

The three stranded commits:

- `22e28654fb` BL-1375: lift the human's rider into invariants, gate the
  fail-closed cases, drain the intake
- `74f8a405fd` BL-1375: narrow the entangled-sibling refusal to
  withheld/unapproved siblings, and guard the replayed tree before a passenger rides
- `c370d1e28a` BL-1375: document the narrowed shared-path refusal and
  PASSENGER_SIBLING outcome

`git branch -a --contains c370d1e28a` returns `expedite/BL-1375` and nothing
else. Local `main` (`2b69c4a47e`) is level with `origin/main`
(`main_sync_status_cli.bb` → `{"ahead":0,"behind":0,"action":"proceed"}`), so
the work is on neither.

## Why this matters today, not just structurally

1. **The fix is CRITICAL and the thing it fixes is still live.** BL-1375 is the
   land-queue deadlock: `own-paths` in `land_step_lib.bb` on `origin/main` still
   carries the strict BL-1332 refusal ("refusing to replay … shared with unlanded
   sibling(s)"), so every ticket sharing `specs/pipeline/steps/index.js` still
   mutually blocks. Any newly minted ticket whose acceptance handler adds a
   `require(...)` line to that file joins the same jam.
2. **Five tickets are parked in `backlog/hold/`** by the run — BL-1296, BL-1309,
   BL-1356, BL-1359, BL-1360 — and Article 3.1 forbids the coordinator promoting
   from `hold/`. They wait on a human either way, but they were parked *for* a
   fix that has not landed.
3. **The backlog says shipped.** BL-1375's file is staged into `backlog/done/`.
   Anything reading the backlog — the briefing, the dashboard, a future
   specifier — reads this ticket as delivered.

## Why nothing caught it

The run reports success and reports its leavings, and both are working as built:

- `history` — seven stages, `"verdict": "pass"` for every one, including QA.
- `"ticket": "done"`, `"ticket-ok?": true`, `"restart": {"outcome": "ok"}`.
- `deferred` — `["bl-topic-record", "briefing-hooks", "pipeline-stage-sync"]`.
  Landing is not among them.
- `outstanding` — exactly two items: the parked tickets, and the uncommitted
  backlog moves. **The branch is not one of them.**

The expeditor genuinely does not land, by design: `docs/how-to/BL-567-…md`
line 75 says the work happens on `expedite/<BL-id>`, "Never `main`", and line
204 says "It does not push. Publishing local `main` is your call on the next
boot." `grep -nE '"main"' swarmforge/scripts/expedite_cli.bb` finds one hit —
`git worktree add -b <branch> <dir> main`, the branch's *starting point*. There
is no merge-to-main step anywhere in the driver.

So the handover is real and intended. The defect is that the mechanism whose
whole job is naming what the run left for someone else — `outstanding-work` in
`expedite_lib.bb:764`, printed on every ending — omits the one leaving that
matters most, in a run that simultaneously marks the ticket done. Its own
how-to says "Each of these is a **handover**, not a drop — the closing summary
names the owner of the two that leave state behind." Landing the branch is a
third thing that leaves state behind, and it is named nowhere.

BL-1310 landed only because a human did it by hand afterwards — `607084ab95
Close BL-1310: status done after expedite land on main.` Nothing told them to;
that run's OUTSTANDING block was equally silent. The handover has been running
on operator memory, and this is the run where memory did not fire.

## Disposition

- Minted **BL-1376** (`type: defect`, `severity: high`) for the reporting gap.
- The live instance is **not** a specifier action: landing pipeline code on
  `main` is QA's (Article 1.8 / 4.2, BL-247), and Article 1.2 forbids me
  merging. Surfaced to the coordinator by priority-`00` note in the same pass.
- Intake `INTAKE-operator-bl1375-passenger-must-pass-registration-guard-…md`
  is **already drained** by `22e28654fb` on the stranded branch. It is left in
  the backlog root rather than re-drained — re-minting the rider would collide
  with that commit when it lands. Recorded in the intake file itself.
