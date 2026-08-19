# Babysitter CRIT "pipeline code landed on main outside QA" — ADJUDICATED FALSE POSITIVE

Date: 2026-08-20 (finding raised against 2026-08-19 commits)
Adjudicated by: coordinator. Article 4.2 / BL-247. **No violation. No remediation needed.**

## Finding
babysitter health sweep flagged two commits, both subject
`Merge remote-tracking branch 'origin/main'`, as landing pipeline code on main
outside QA:

- `da6031c60` — flagged extension/src/concierge/pipelineBoard.ts, two extension/test
  files, specs/pipeline/steps/bl956PipelineBoardCaptionCapSteps.js, steps/index.js
- `b3ba48bfc` — flagged 6 extension/src files, 6 extension/test files,
  3 specs/pipeline/steps files, steps/index.js

## Adjudication method
Per the known detector shape, a merge commit must be adjudicated against BOTH
parents, never by `--name-only` (which is blind to merge commits). For every
flagged file:

    git diff --name-only <sha>^1 <sha> -- <file>   -> 1  (differs from local main)
    git diff --name-only <sha>^2 <sha> -- <file>   -> 0  (IDENTICAL to parent2)

`vs_p2 = 0` on every single flagged file: the merge result equals parent2 exactly,
so the content came from the parent2 side, not from the merge.

## Why that clears it
Parent2 of `da6031c60` is `33625c72f` = **"BL-955: QA pass inventory - all gates
run, zero defects"** — a QA commit, and the head of `swarmforge-QA`.
Parent2 of `b3ba48bfc` is `2d64a4b9d`, likewise contained in `swarmforge-QA`.

The flagged content is BL-954 / BL-955 / BL-956 / BL-827 — the four tickets QA
approved and landed on 2026-08-19, each closed to `backlog/done/M8` with a QA pass
inventory. It entered main through QA's own landing, which is exactly the correct
BL-247 path. The two flagged commits are the operator's local
`git merge origin/main` reconciliations bringing the local ref up to date; they
authored none of it.

## Real (process) defect this exposes
`swarmforge/scripts/check_pipeline_code_on_main.sh` contains no merge adjudication
(no `^2`, no `--first-parent`, no `diff-tree -m`), so every reconciliation merge of
QA-landed work re-raises a CRIT and nudges the coordinator. BL-632 (commit-time
guard) and BL-925 (reconcile-merge completion) are both closed and neither covers
this. Routed to the specifier to decide whether to mint — not self-minted here.
