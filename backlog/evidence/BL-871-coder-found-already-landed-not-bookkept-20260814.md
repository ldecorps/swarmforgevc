# BL-871 — coder found: already landed on main, never bookkept to done/

Routed to coder 2026-08-14 (mailbox note `10_20260814T055201Z_000329`) as if
unstarted. It is not: the bounce-reentry fix is already on `main`, verified
by commit ancestry, not by worktree presence (per the local-main-lags
lesson — checked BOTH refs).

## Chain, oldest to newest (all confirmed ancestors of `main` via
   `git merge-base --is-ancestor <sha> main` and separately against
   `origin/main` after `git fetch origin main` — both YES)

- `2a231c091` — coder: cap the property lane's worker pool to the shared budget module
- `00d0a8e7b` / `669111570` — architect/hardener passes (original)
- `052a1f4f0` — documenter, forwarded to QA
- `eeb0f9501` — QA bounce (D1: acceptance timeout too short; D2: subprocess-heavy files still flaky)
- `2d1fbd27a` — coder bounce-reentry fix (raises D1's spawnSync timeout, D2's
  per-file testTimeout/spawnSync budgets on bl760/bl787/bl797, and adds
  `dangerouslyIgnoreUnhandledErrors: true` for the unconfigurable Vitest
  worker-RPC `onTaskUpdate` 60s heartbeat — see
  `backlog/evidence/BL-871-coder-pass-bounce-reentry-20260811.md`)
- `e80ac388f` — architect bounce-reentry pass, clean
- `ece5b0949` — hardener bounce-reentry pass, independently reconfirmed D1/D2/third-mechanism at normal load
- `823d46247` — documenter bounce-reentry pass, forwarded to QA

## What's missing

No commit anywhere in `git log --all` reads "BL-871 ... QA final gate" or
similar. `823d46247` merges into `swarmforge-QA` (commit `88ed16b26`), but
QA's very next distinct final-gate commit on that branch is for **BL-879**,
not BL-871 — `823d46247` rode along inside BL-879's later QA-approved
merge-up to `main` without ever getting its own QA approval commit or its
own coordinator bookkeeping note. This is the Article 2.6 failure shape
(BL-417/BL-420): a ticket whose code lands folded into a LATER ticket's
QA-approved batch, but whose own ID is never named in the approval or the
bookkeeping note, stays active forever — `backlog/active/BL-871-property-
lane-worker-pool-cap.yaml` is present, unmoved, on `main` itself right now.

## Current file state on `main` confirms the fix is live, not just merged

`extension/vitest.properties.config.mjs` on `main` already has
`dangerouslyIgnoreUnhandledErrors: true` and `poolOptions.forks.maxForks:
WORKER_POOL_SIZE` (the shared-budget-module wiring, invariant 2). Nothing
for the coder to implement.

## Requested action

Coordinator bookkeeping only (no git merge/push per Article 1.1/3.3):
move `backlog/active/BL-871-property-lane-worker-pool-cap.yaml` to
`backlog/done/`, recheck `active_backlog_max_depth`, promote+route the next
eligible paused item into the freed slot.

By coder.
