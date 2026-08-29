# BL-891: Master-Main Reconcile Sweep — Understanding the Note

**QA can only ever `git push origin HEAD:main`.** Landing a commit advances
`origin/main`, but git refuses to update a branch that is checked out in
another worktree — and `main` is checked out in the master checkout, where
the coordinator and specifier do all their reading. Nothing else was ever
wired to bring the local `main` ref forward, so every landing left the
master checkout's tree further behind, and every backlog/spec commit the
coordinator and specifier wrote locally in the meantime made it not just
stale but **diverged** — a real merge away from `origin/main`, not a simple
fast-forward. A specifier scope decision written against a 20-minute-stale
local `main` is the incident that surfaced this (BL-891's own `notes:`).

This sweep closes that gap. It is **best-effort reconciliation**, not an
alarm — see "What it does not do" below for the one case it only reports.

## Kill switch (BL-1248)

Operators can disable the reconcile **action** without tearing down the
daemon. In `swarmforge/swarmforge.conf`, set:

```text
config master_main_reconcile_enabled false
```

Only the exact value `true` enables the action; absent, empty, malformed,
and `false` all fail closed to disabled. While off, drift logging and
dirty-blocked / conflict surfacing+escalation still run — the switch skips
only the `:merge!` path inside `master-main-reconcile-lib/sweep!`. A skip
logs `master-main-reconcile skipped-by-config`. This repo ships `false`;
re-arming after BL-1236 landed is tracked as BL-1251. Full operator recipe:
[Disable (or re-enable) the master-main-reconcile sweep from config](BL-1248-master-main-reconcile-kill-switch.md).

## What it does

Runs on the same `handoffd.bb` cadence as every other sweep (dispatch-gap,
push-sweep, flow watchdog, master-checkout drift). Each tick:

1. Reads local `main`'s ahead/behind counts against `origin/main` (reusing
   the same `git fetch`-then-count call BL-356's push-sweep already makes
   each tick — no second fetch).
2. If local `main` is not behind, there is nothing to reconcile — done.
3. **(BL-919)** If it is behind, it compares which paths are dirty in the
   master checkout's working tree against which paths the incoming merge
   would itself change. If there is **no overlap** — including when the
   tree is dirty but on paths the merge never touches — it runs
   `git merge --no-edit origin/main` in the master checkout: a plain
   fast-forward when there are no local-only commits, or a real merge
   commit when there are — either way every prior commit, local-only
   bookkeeping included, stays reachable, and the dirty files are left
   byte-identical. A clean tree is just the zero-dirty-paths case of the
   same check, so it always reconciles as before.
4. If a dirty (or untracked) path **does overlap** a path the merge would
   change, or the overlap computation itself could not run, it does not
   touch the checkout — it sends a `note` (priority `00`) naming the
   offending path(s) to the coordinator and stops. Uncertainty always fails
   closed to blocked, never to reconciling.
5. **(BL-1130)** Before starting a merge, merge-tree foresight refuses a
   known content conflict with `:refuse-rematch` (clean worktree — no
   `MERGE_HEAD`). If a merge this tick started still conflicts, it aborts
   immediately and surfaces rematch/refuse — never "finish in an editor".
   **(BL-1120)** If `MERGE_HEAD` already existed, the tick skips entirely
   and surfaces `human-merge-in-progress` without `git merge --abort`.

**(BL-925)** Step 3's merge used to be refused for a reason that had
nothing to do with a real conflict: `origin/main`'s incoming tip routinely
carries pipeline-code paths (`extension/src/`, `extension/test/`,
`specs/pipeline/steps/`) that [BL-632's commit-time
guard](../reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md)
refuses from any non-QA writer — and the master checkout doing this merge
is never QA. The guard had no notion of a merge at all, so importing
content QA had already published was indistinguishable to it from fresh
non-QA authorship; `master-main-reconcile-merge!` read that refusal as an
ordinary git failure, aborted, and logged it as verdict "merge conflict,
aborted" even though there was no real conflict. Because the ahead-and-
behind shape this sweep exists for is the steady state, that false
conflict recurred on every tick and the join never completed. The guard
now recognizes an incoming merge parent that is already an ancestor of
`swarmforge-QA` and exempts only the paths whose staged content is
byte-identical to that parent's, so this specific join now succeeds; a
genuine content conflict still aborts exactly as before.

## Verdicts

| Outcome | What happened |
|---|---|
| up to date | Local `main` already has everything `origin/main` has. Nothing emitted. |
| reconciled | Local `main` was behind and no dirty path overlapped a path the merge would change (clean tree, or dirty-but-non-overlapping) — merged forward automatically. Nothing emitted; check `git log` if you want to see it happen. |
| dirty overlap, not reconciled | Local `main` is behind and a dirty (or untracked) path collides with a path the incoming merge would write to — the one case a plain `git merge` would itself refuse. The sweep leaves the checkout exactly as it found it and surfaces a `note` naming the offending path(s) (a count, past the first, if naming them all would blow the note's 80-char budget) to the coordinator. |
| merge conflict / refuse-rematch (BL-1130 / BL-1141) | Predicted or real conflict on the **automated** path. Aborted (or never started); checkout has no `MERGE_HEAD` / unmerged paths. **(BL-1141)** live handoffd / Process B then **execute** rematch onto `origin/main` so `behind=0` — not a standing Cursor wait-reconcile. Do not finish a daemon merge in an editor. |
| human merge in progress (BL-1120) | `MERGE_HEAD` was already set when the tick ran. The sweep does **not** merge and does **not** abort — a human (or other agent) owns the join. Surfaces a note; finish or abort the merge yourself. |

Both surfaced cases send **one** note and then go quiet for that same reason
— reaching a clean/resolved state clears the flag, so a *later*, unrelated
block always surfaces fresh rather than being silently swallowed by a stale
flag from an already-resolved episode (the same self-healing shape
push-sweep's own alarm flags use).

## Operator workflow

1. Receive a `BL-891: master main <N> behind origin, dirty overlap[: <path>
   | : <N> paths] - not reconciled` (or `... hit a merge conflict, aborted,
   <N> behind`) note in the coordinator's queue. **A routine dirty tree with
   no overlap no longer generates this note at all** (BL-919) — it
   reconciled on the same tick instead, so seeing this note means the dirt
   is specifically in the incoming merge's way.
2. Look at the named path(s) in the master checkout directly (`git -C
   <repo> status`, `git -C <repo> diff -- <path>`) and decide by hand
   whether to commit it, stash it *only if you are certain nothing else in
   the repo needs that stash slot* (`git stash` is repo-wide — prefer
   committing), or otherwise resolve it.
3. Once the overlapping path is no longer dirty, the next sweep tick
   reconciles automatically — there is no manual merge command to run. Any
   *other* dirty path in the tree, overlapping or not, is irrelevant to
   this decision.
4. For an automated conflict refuse (BL-1130 / BL-1141): the checkout is
   already clean. Live absorb **rematches** onto `origin/main` automatically
   (BL-1141); a standing `refuse-rematch` wait for Cursor is not the designed
   end state. Re-land any ticket tip that still needs tip purity. Do not open
   an editor to finish a merge the daemon refused. Human-owned mid-merges
   still follow BL-1120.

## What it does not do

- Never `reset --hard`, `rebase`, `stash`, or force-updates the ref — a
  checkout the sweep declines to touch is left byte-identical, never
  partially updated (this is BL-891's own two declared invariants).
- Never pushes anything — that direction is push-sweep's job (BL-356); this
  sweep only ever merges `origin/main` **forward into** local `main`.
- Does not resolve conflicted file contents. Automated path aborts/refuses
  and surfaces rematch (BL-1130); it never leaves mid-merge for an editor.
- Does not block on dirt that the incoming merge would never touch (BL-919)
  — only an actual path overlap, or an uncertain overlap computation, blocks.
- Re-running the sweep on an already-reconciled tree is a no-op by
  construction (step 2 above).


## Process B — post-Cursor-batch merge of origin/main (BL-1118)

Local `main` often advances from Cursor/operator batches while QA lands on
`origin/main`. Do **not** wait for the next BL-891 reconcile tick.

**Keep `SWARMFORGE_ROLE=QA` for pipeline-path hotfix lands on main** (BL-632
unchanged). This slice does **not** add `SWARMFORGE_HOTFIX=1` or any other
exemption.

### Post-batch checklist

1. Land the hotfix with `SWARMFORGE_ROLE=QA` when touching
   `extension/src|test` or `specs/pipeline/steps`.
2. Before ending the Cursor/operator session, run:

```bash
bb swarmforge/scripts/post_hotfix_merge_origin.bb <project-root>
```

3. Exit `0` means fetch+merge succeeded (or already up to date), including
   **(BL-1141)** successful rematch after a refuse-rematch plan. Exit `1`
   with `:refuse-rematch` means rematch itself failed (or mid-merge blocked
   recovery): the helper left the worktree **not** mid-merge. Retry; never
   finish a refused absorb in an editor, and never treat Cursor
   Complete-origin/main-merge as the standing path.
4. A clean tip that is still behind must not stay stuck on a stale dirty
   deadlock/sync reason — the helper refreshes that honesty seam (see
   `post_hotfix_merge_origin_lib.bb`).

Also named in [BL-848](BL-848-certify-an-operator-hotfix.md) as the
post-batch merge helper operators run after declaring a hotfix.

## Coordinator step 0 and the main-sync deadlock breaker (BL-1113)

Stamp-off of Cursor hotfix `27273f2b0a` (ledger certification still follows
[BL-848](BL-848-certify-an-operator-hotfix.md)). BL-891 still owns the
reconcile join itself; this layer only **gates coordinator bookkeeping** and
stops drop-nudge spam while local `main` is behind.

**Status CLI.** `swarmforge/scripts/main_sync_status_cli.bb <project-root>`
prints one JSON object with `ahead`, `behind`, `ready`, and the only allowed
`action`. Counts use `origin/main...main` bound as `[behind ahead]` — same as
handoffd (BL-1115 stamp-off of hotfix `a3bf11b533`; do not invert the range):

| `ahead` / `behind` / deadlock | `action` |
|---|---|
| behind = 0 (deadlock clear) | `proceed` |
| behind > 0, ahead = 0 | `ff-only` |
| ahead > 0 and behind > 0 | `wait-reconcile` |
| deadlock marker active | `deadlock-tripped` |

**Trip-once deadlock.** When behind stays positive long enough with an aged
coordinator `in_process` parcel (and ahead>0 or a dirty/conflict reconcile
escalation), `master_main_reconcile_lib.bb` writes
`.swarmforge/daemon/main-sync-deadlock.json`, raises **at most one** alert for
that trip, and suppresses dropped-parcel nudges until `behind=0` (then the
marker clears). Do not treat a quiet drop-nudge path as “reconcile finished”
while the deadlock marker is still active — clear behind first.

## See also

- [BL-632: Commit-Time Guard Refuses Pipeline Code on
  Main](../reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md)
  — the guard whose merge-import exemption (BL-925) is what lets this
  sweep's merge complete instead of appearing as a false "merge conflict,
  aborted".
- [Master-Checkout Drift Alarm](BL-839-master-checkout-drift-alarm.md) — a
  different sweep in the same cadence, alarming on a different question
  (does the working tree's *script content* still match `main`, not
  whether the local `main` *ref* itself is current).
- [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
  — the BL-891 changelog entry, and the BL-356 push-sweep entry this sweep
  mirrors in the opposite direction.
