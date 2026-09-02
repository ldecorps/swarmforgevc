# Coordinator: main-sync stall on BL-1330 bookkeeping — 2026-09-02

## Trigger
QA note in coordinator inbox (in_process): "BL-1330 approved+landed 0a5bffe057 - bookkeep"

## main_sync_status_cli.bb output
```
{"ahead":2,"behind":1,"ready":false,"action":"wait-dirty-clear",
 "reconcile":{"surfaced":"human-merge-in-progress","ticks":33,"escalated":true},
 "deadlock":{}}
```

## Observed git state
- `git status`: "All conflicts fixed but you are still merging." MERGE_HEAD =
  `0a5bffe057` (the QA-landed BL-1330 commit named in the note).
- `git diff --cached` is EMPTY (index == HEAD) — no merge resolution is
  actually staged despite the "conflicts fixed" message.
- `git diff HEAD MERGE_HEAD --stat` shows real, substantial BL-1330 content
  (evidence files, `bl1330SwarmStampBobAnthropicStartingCastSteps.js`,
  `bl1330QwenRemapPredicateCli.zsh`, `specs/pipeline/steps/index.js` entry,
  topic file) that is **not yet present on local `main`**.
- `git status --porcelain=v2 -uall` shows **no unmerged (`u`) entries** — so
  this is not a live conflict; MERGE_HEAD is a dangling leftover.
- `git reflog` top entry: `HEAD@{0}: reset: moving to HEAD` immediately
  after `commit: BL topic record for BL-1334` — consistent with a merge
  attempt that was abandoned via `git reset`, which left `.git/MERGE_HEAD`
  behind without clearing it.
- Two unrelated unstaged files also dirty: `backlog/hotfix-ledger.yaml`,
  `backlog/paused/BL-472-wire-babashka-hardening-toolchain.yaml`.

## Why I am NOT acting further
Per coordinator role instructions (main-sync step 0): on `action:
wait-dirty-clear` / `wait-reconcile` / `deadlock-tripped`, do NOT run
`--ff-only` (would fail, ahead>0), do NOT merge myself (Article 1.1/BL-247 —
the daemon owns non-ff joins, and completing this merge by hand risks
silently dropping BL-1330's content exactly like the merge/reconcile
silent-drop incidents in memory). Keep the QA parcel `in_process`, report
loudly, stop this turn.

`reconcile.escalated: true` — the daemon has already alerted on this stall
(ticks=33). This is a machinery stall (dangling MERGE_HEAD blocking the
reconcile sweep), not a routine dirty-overlap I should hand-clear per
[[main-sync-dirty-overlap-deadlock-needs-hand-clear-not-wait]] — that memory
covers uncommitted dirt on overlapping paths, not a stale MERGE_HEAD with an
empty index.

## State left for resume
- QA note for BL-1330 stays in `inbox/in_process` (unfinished bookkeeping).
- BL-1330's YAML has not been moved to `backlog/done/` yet — do that only
  after `main_sync_status_cli.bb` reports `ready:true`/`proceed` and the
  merge is properly resolved (either by the daemon's reconcile sweep or by
  a human clearing `.git/MERGE_HEAD`).
- Next coordinator turn: re-run `main_sync_status_cli.bb .` before anything
  else; if still stalled, escalate to the human rather than re-deriving this
  analysis.
