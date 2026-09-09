# Article 4.2 escalation `pipeline-code-on-main-e274174322…` — FALSE POSITIVE

Adjudicated by the operator, 2026-09-08 05:38Z (all times UTC; host is UTC+1).

## Subject

`pipeline-code-on-main-e274174322776d669eca71a3dff00bcf1ee7a61c` —
"BL-1480: tip-pure replay onto origin/main (BL-1241 land-step remedy)",
landed on `main` 2026-09-08 05:33:34Z. Flagged paths:

- `specs/pipeline/steps/bl1480PromoteRouteFixtureClosureSteps.js`
- `specs/pipeline/steps/lib/bbFixtureClosureGate.js`

Also covers the immediate follow-up land `c33e2f06af` (05:35:31Z, same
subject) if it is delivered separately — same cause, same verdict.

## Verdict: nothing unreviewed landed

Timing-free dismissal (blob-SHA compare, correct at any age):

| path | landed `e274174322` | landed `c33e2f06af` | replay source `de5b6aa6cc` | QA-approved `b34dba24fc` |
|---|---|---|---|---|
| `bl1480PromoteRouteFixtureClosureSteps.js` | `d51f72b988` | `d51f72b988` | `d51f72b988` | `d51f72b988` |
| `bbFixtureClosureGate.js` | `0b51878811` | `0b51878811` | `0b51878811` | `0b51878811` |

Byte-identical on both flagged paths across all four commits. QA's own pass
(`backlog/evidence/BL-1480-QA-20260908.md`) records **NONE outstanding** and
"Approved for landing on documenter commit `b34dba24fc`". Bounce arm ruled
out explicitly: no record naming `e274174322`, `de5b6aa6cc` or `BL-1480` in
`.swarmforge/bounces/`. `c33e2f06af` adds only 8 lines to the BL-1480 ticket
YAML and reverts nothing main carried (`git diff e274174322 c33e2f06af` =
1 file, +8) — the BL-1445/BL-1473 two-tree-diff revert hazard did NOT bite.

## Why the predicate says "not approved"

`is_qa_ancestor.sh` returns rc=1 (clean "no", not undeterminable):

```
not approved: e274174322 has a land-replay record naming source de5b6aa6cc,
which is not itself approved (.swarmforge/land-approvals/2026-09.jsonl)
not approved: c33e2f06af has a land-replay record naming source de785988af,
which is not itself approved
```

Both ledger rows are well formed and were written within 5s of their lands
(05:33:39.7Z, 05:35:37.0Z). The failure is the BL-1334 replay fallback: a
source is "approved" only if it is an ancestor of the **`swarmforge-QA`
branch ref**, and neither named source is.

**Root cause is the frozen `swarmforge-QA` ref, again.** The branch ref sits
at `a3deec8c60` ("Merge main aefcde7a03 into QA", 05:00:33Z) — its last
reflog entry — while QA does all of its current merge-back work on
**`bl1471-landing`**: `.worktrees/QA` HEAD is `de785988af` ("Merge main
e274174322 into QA", 05:35:24Z) on `bl1471-landing`, and `git branch -a
--contains de785988af` lists that branch alone. So QA *is* merging main up;
the commits just never reach the ref the predicate reads. Divergence at
05:36Z: `swarmforge-QA..main` = 3, `main..swarmforge-QA` = 8.

This is the same frozen-ref cause adjudicated for BL-1445 earlier today
(`babysitter-article42-bl1445-mergeup-chain-qa-ref-frozen-20260908.md`,
`…-bl1445-qa-handland-stale-qa-ref-20260908.md`). The direct nudge sent to
QA at 05:00Z pointing at `.swarmforge/operator/NOTE-qa-ref-20260908.md` was
destroyed by the 05:01:18Z night-closing-ceremony teardown (swarm dead
05:01–05:11Z, recovered by `./start-swarm.sh`); the current QA pane is a
fresh process that never saw it. The NOTE file is still on disk.

## Action taken: record only

First delivery of this sha. No nudge (QA is mid-merge-back right now — the
`de785988af` merge is ~1 minute old — and a nudge mid-turn would push it
toward a record that a `swarmforge-QA` ref update makes unnecessary). No
waive: BL-1404 has not landed, so the escalation channel ignores waives, and
a land-approval close-out is QA's to record (BL-1405), not the coordinator's.
No operator merge, no code edit, no commit.

**Close-out owed if this re-fires:** QA advances the `swarmforge-QA` branch
ref to include the `bl1471-landing` merge-ups (or re-records the
land-approval naming a source that IS a current `swarmforge-QA` ancestor) so
`is_qa_ancestor.sh e274174322` exits 0. Never re-derive the review question —
it is settled above.

## Swarm health at adjudication (05:36Z)

9/9 role panes up; `handoffd.heartbeat` 05:34:45Z (fresh); provider
available; `babysitterd_watchdog` healthy (pid 28173, pidfile alive);
pipeline board `lastChangeMs` 05:33:58Z (fresh, no freeze); backlog
active=1 paused=104 done=712.
