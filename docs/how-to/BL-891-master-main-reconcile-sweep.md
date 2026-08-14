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

## What it does

Runs on the same `handoffd.bb` cadence as every other sweep (dispatch-gap,
push-sweep, flow watchdog, master-checkout drift). Each tick:

1. Reads local `main`'s ahead/behind counts against `origin/main` (reusing
   the same `git fetch`-then-count call BL-356's push-sweep already makes
   each tick — no second fetch).
2. If local `main` is not behind, there is nothing to reconcile — done.
3. If it is behind and the master checkout's working tree is **clean**,
   runs `git merge --no-edit origin/main` in the master checkout: a plain
   fast-forward when there are no local-only commits, or a real merge
   commit when there are — either way every prior commit, local-only
   bookkeeping included, stays reachable.
4. If it is behind and the working tree is **dirty**, or the merge hits a
   conflict, it does not touch the checkout — it sends a `note` (priority
   `00`) to the coordinator and stops.

## Verdicts

| Outcome | What happened |
|---|---|
| up to date | Local `main` already has everything `origin/main` has. Nothing emitted. |
| reconciled | Local `main` was behind and the tree was clean — merged forward automatically. Nothing emitted; check `git log` if you want to see it happen. |
| dirty tree, not reconciled | Local `main` is behind but the master checkout has uncommitted changes. The sweep leaves the checkout exactly as it found it and surfaces a `note` to the coordinator. |
| merge conflict, aborted | The merge itself hit a conflict. Aborted immediately (`git merge --abort`) so the checkout is never left mid-conflict — surfaced to the coordinator the same way. |

Both surfaced cases send **one** note and then go quiet for that same reason
— reaching a clean/resolved state clears the flag, so a *later*, unrelated
block always surfaces fresh rather than being silently swallowed by a stale
flag from an already-resolved episode (the same self-healing shape
push-sweep's own alarm flags use).

## Operator workflow

1. Receive a `BL-891: master main <N> behind origin, dirty tree - not
   reconciled` (or `... hit a merge conflict, aborted, <N> behind`) note in
   the coordinator's queue.
2. Look at the master checkout directly (`git -C <repo> status`,
   `git -C <repo> diff`) — a dirty tree here is routine (the coordinator and
   specifier both do in-progress backlog/spec editing there), so decide by
   hand whether to commit it, stash it *only if you are certain nothing else
   in the repo needs that stash slot* (`git stash` is repo-wide — prefer
   committing), or otherwise resolve it.
3. Once the tree is clean, the next sweep tick reconciles automatically —
   there is no manual merge command to run.
4. For a conflict: the abort already happened, so the checkout is safe to
   leave as-is while you investigate; resolve by hand (e.g. merge
   `origin/main` yourself and fix the conflict) once you're ready.

## What it does not do

- Never `reset --hard`, `rebase`, `stash`, or force-updates the ref — a
  behind-and-dirty checkout is left byte-identical, never partially
  updated (this is BL-891's own two declared invariants).
- Never pushes anything — that direction is push-sweep's job (BL-356); this
  sweep only ever merges `origin/main` **forward into** local `main`.
- Does not resolve a merge conflict on your behalf. It aborts and surfaces;
  a human resolves it.
- Re-running the sweep on an already-reconciled tree is a no-op by
  construction (step 2 above).

## See also

- [Master-Checkout Drift Alarm](BL-839-master-checkout-drift-alarm.md) — a
  different sweep in the same cadence, alarming on a different question
  (does the working tree's *script content* still match `main`, not
  whether the local `main` *ref* itself is current).
- [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
  — the BL-891 changelog entry, and the BL-356 push-sweep entry this sweep
  mirrors in the opposite direction.
