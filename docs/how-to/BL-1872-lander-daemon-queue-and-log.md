# Queueing a land and reading the lander's log (BL-1872)

**Until BL-1872 lands (its activation prose, BL-798), QA still lands its own
approved commits exactly as `QA.prompt`'s current recipe says — this how-to
describes the behavior that takes over once it does.** The pack mechanics
below (`lander_queue.bb`, `handoffd.bb`'s sweep, `.swarmforge/lander/`) are
already built and tested; only QA's own recipe step still points at the old
path until the ticket activates.

## What changes

Today, QA's last act on an approved parcel is running
`land_main_publish.sh --land` itself — the whole land (building the commit,
pushing, re-pointing QA's branch) runs inside QA's own turn, and a slow or
stuck land holds QA (and therefore the whole pipeline behind it) hostage to
it.

Once BL-1872 is active, QA's last act is one queue command instead. The
land itself runs in the background, in a worktree of its own, driven by
`handoffd`'s lander sweep — QA's turn ends the moment the command returns.

## Queueing a land

```bash
bb swarmforge/scripts/lander_queue.bb <project-root> --enqueue <task-name> <full-sha> [<issue-ref>]
```

- Resolves `<full-sha>` read-only against the repo (refuses with exit `2` if
  it doesn't resolve to a real commit) and writes one entry under
  `.swarmforge/lander/queue/<task-name>-<sha10>.edn`. It never fetches,
  builds, or pushes anything itself — that is the sweep's job, not the
  queue command's.
- Prints `LANDER_QUEUED <id>` on a fresh entry, or `LANDER_ALREADY_QUEUED
  <id>` if the same task and commit were already queued — queueing twice is
  harmless, never a second land.
- `<id>` is `<task-name>-<sha10>` (the commit abbreviated to 10 hex chars) —
  the same id names the entry file and the log/exit files below.

## What the sweep does with it

`handoffd.bb`'s lander sweep (`lander-sweep!`) ticks once per cycle:

- **At most one land runs at a time, oldest queued first.** A running entry
  blocks every other start; once its exit code is known, the sweep reads
  the outcome on a later tick.
- The land runs in `.worktrees/lander` (branch `swarmforge-lander`, created
  from `origin/main` on first use) — **never QA's own worktree** — via
  `land_main_publish.sh <lander-worktree> --land <task> <sha> [<issue>]`,
  detached (`setsid`, never wrapped in `timeout`: a kill mid re-point would
  leave a branch half-moved).
- Output goes to `.swarmforge/lander/<task-name>-<sha10>.log`, and the exit
  code to the sibling `.exit` file next to it.
- **A run still going past an hour** gets one `note` to QA saying so
  (`"<ticket> land still running past an hour; left alone"`) and is left
  running — the sweep never kills or retries it.

## Reading the outcome

Once the detached land exits, the next sweep tick reads
`.swarmforge/lander/<id>.log` and its `.exit` file and decides exactly one
of two outcomes — recorded back into the queue entry, never left pending:

- **Landed** — exit `0` and the log contains a `LAND_PUBLISHED <sha>` line.
  The coordinator gets the same bookkeeping note QA composes today for a
  land (`ceremony_handoff_lib.bb`'s `compose`, never retyped by the
  sweep) — no change to what the coordinator receives.
- **Refused** — anything else. The log's own words become the reason, in
  this order: `ENTANGLED_SIBLING_BLOCK`, `LAND_ESCALATE` (with its reason
  line), a `LAND_STOPPED` line, exit `0` with no `LAND_PUBLISHED` line
  (reported verbatim as such), or the bare exit code. QA gets a `note`:
  `"<ticket> land refused: <reason>"`, capped at 80 characters.

**A refusal note means exactly what a refusal meant before BL-1872** — QA
adjudicates it the same way it adjudicates `LAND_ESCALATE` today (see
`QA.prompt`'s land recipe and the `BL-1537` land-escalate condition log it
points at). The sweep never retries a refused entry on its own; a retry
means queueing a fresh commit for the same task.

## The rematch no longer detaches a worktree, and records what it publishes

Two fixes to `land_main_publish.sh`'s existing single-rematch path ride
along with the lander, because QA no longer has a hand at the keyboard to
catch them:

- The rematched commit is built with `git merge-tree --write-tree` +
  `commit-tree` directly onto `origin/main`, with no `git checkout` of any
  kind — so a rematch never leaves any worktree on a detached `HEAD` (it
  used to, when the rematch ran a bare-sha `rebase`).
- The rematched commit's land-approval record is written (against the same
  approved source the original replay's record names) **before** the
  rematch's own push, not after — so a crash between the two never leaves a
  published commit with nothing recording it as approved.

## Where it lives

| Piece | Location |
| --- | --- |
| Pure decisions (`entry-id`, `next-action`, `outcome`, `outcome-note`, `overdue-note`) plus impure `enqueue!`/`read-entries`/`lander-worktree`/`tick!` | `swarmforge/scripts/lander_lib.bb` |
| QA's queue command | `swarmforge/scripts/lander_queue.bb` |
| Sweep registration | `swarmforge/scripts/handoffd.bb` (`lander-sweep!`) |
| The rematch's no-checkout rebuild and pre-push record | `swarmforge/scripts/land_main_publish.sh` |
| Step handler | `specs/pipeline/steps/bl1872LanderDaemonSteps.js` |

Acceptance: `specs/features/BL-1872-the-lander-daemon-lands-what-qa-approves.feature`

## See Also

- [A role takes up a parcel on its own line](BL-1871-parcel-line-take-up.md) — the reason no merge-up broadcast is sent once this activates: under parcel lines there is nothing for it to merge onto.
- `swarmforge/roles/QA.prompt`'s land recipe — the "Until BL-1872 lands" interim this how-to describes the far side of.
