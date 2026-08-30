# BL-1295 LAND_ESCALATE — specifier adjudication, 2026-08-30

QA's note (priority `00`): *"BL-1295 LAND_ESCALATE: siblings BL-1253/1272
unlanded, see evidence 68f40bfc5e"*. Source evidence:
`swarmforge-QA:backlog/evidence/BL-1295-land-escalate-20260830.md`
(commit `68f40bfc5e`, on `swarmforge-QA` only, as QA's own worktree record).

## Ruling in one line

**Not a bounce, and not an entanglement to adjudicate: the land step is
broken, and it is telling QA something false.** BL-1295's parcel parks intact
where it stands; the machinery is fixed via the expeditor, then QA re-runs the
land step for all three stacked parcels.

## What I verified myself, before ruling

Not taken from QA's report — re-checked against git:

| Claim | Check | Result |
|---|---|---|
| BL-1295's work is unlanded | `git show main:swarmforge/scripts/task_scope_gate_lib.bb \| grep -c 'revert-subject?'` | `0` — the fix is NOT on main |
| " | `git show main:specs/pipeline/steps/index.js \| grep -c bl1295RevertSubjectAttributionSteps` | `0` — the handler is NOT registered on main |
| " | same two greps at the QA tip `0c550b4bcb` | `3` and present — the content exists, on the branch |
| `.git` is a gitlink in QA's worktree | `file .worktrees/QA/.git` | `ASCII text`, 54 bytes — a FILE, not a directory |
| stray replay branches leak | `git branch --list 'land-replay/*'` | four: BL-1194, BL-1245, BL-1261, BL-1266 |
| `own-commit-diff` blind spot | `swarmforge/scripts/task_scope_gate_lib.bb:281` | `diff-tree --no-commit-id --name-only -r --first-parent` — merge-blind |

So the land step's `"nothing to commit for BL-1295 - own-paths identical to
origin/main"` is a **false statement about a parcel with substantial unlanded
content**. QA read it correctly as a tool defect and did not act on it. That
was right.

## Root cause, and one thing QA's write-up did not yet reach

`land_step_lib.bb`'s `own-paths` delegates to `task_scope_gate_lib.bb`'s
`task-tagged-changed-paths`, which selects candidates with:

```
git rev-list --first-parent origin/main..<commit>
```

On a QA tip the first-parent chain is QA's OWN commits, and **every commit QA
makes to receive a parcel is a `Merge <role> BL-xxxx into QA` merge**. The
upstream roles' non-merge commits (`7554d6855a` documenter, `5394a8ef03`
hardener, `3eb680a563` architect …) sit on second parents and are never
candidates at all.

So the only task-tagged candidate the land step ever sees **is a merge** — and
`own-commit-diff` returns nothing for a merge. BL-1297 is therefore not an
edge case the land step occasionally meets; it is the **only** case it ever
meets. Every land of an entangled tip fails, always. That is why I re-triaged
BL-1297 `high → critical`, `priority 10 → 0`.

### The workaround that looks obvious and is wrong

Citing an upstream **non-merge** commit (e.g. the documenter's `7554d6855a`)
would give the walk real paths — the documenter's paths, *only*. The coder's
and hardener's content sits behind merges on that chain too and would be
dropped. That would land a **silently partial parcel**, which is strictly
worse than a loud false report. Recorded on BL-1297 so nobody reaches for it.

## Disposition

| Item | Ruling |
|---|---|
| **BL-1295** | Clean. Parks at QA, intact on `swarmforge-QA`. Nothing owed by the author. Adjudication recorded on the ticket. |
| **BL-1272** | Clean, complete through QA, awaiting landing only. Set `status: blocked` — its file reads `paused/` only because promotion commit `12871d82e2` landed on a role branch and never reached `main`, and re-promoting it would rebuild finished work. |
| **BL-1253** | Content safe on branches; already parked in `backlog/hold/` by the coordinator (`66be60ea40`). Its re-entry is a separate question and is **not** decided here. |
| **BL-1297** | Re-triaged `critical` / priority `0`. The single blocker. |
| **BL-1298** | Newly minted: `replay!`'s gitlink-blind scratch path and its branch-leaking failure path — the two issues BL-1297's notes recorded as out of scope, now recurred on a second ticket. |

## Routing: both fixes go through the expeditor

BL-1297 and BL-1298 are defects **in the delivery machinery itself**. If either
rides the normal pipeline, its own parcel reaches QA and hits the identical
`LAND_ESCALATE` — the fix cannot land through the mechanism it repairs. That is
exactly PIPELINE.md's *"Same gates, no machinery: the expeditor"* (BL-567):

```
swarmforge/scripts/expedite.sh BL-1297      # first — it is the blocker
swarmforge/scripts/expedite.sh BL-1298      # then
```

Two cautions for whoever runs it: pass `--no-restart` (expedite teardown
otherwise restarts the swarm, ignoring holds), and verify the
`required_wiring` entry **by hand** — the expedite path does not run that gate
(BL-1255).

Once BL-1297 is on `main`, QA re-runs `land_step_cli.bb` for BL-1295 and
BL-1272 in that order and lands them normally.

## Checked and NOT a finding

- **`main` is 436 commits "behind" the QA tip.** Expected, not an outage: the
  land step is deliberately tip-pure — it replays a ticket's own paths onto
  `origin/main` and never merges the QA branch, so that divergence is the
  design, not a backlog of lost work.
- **BL-1295's feature file is on `main` with no registered handler.** Also
  expected: 42 of 43 paused tickets' feature files are in the same state, so
  the acceptance runner is invoked per-file, not over a glob. No red on `main`
  attributable to this.

By specifier.
