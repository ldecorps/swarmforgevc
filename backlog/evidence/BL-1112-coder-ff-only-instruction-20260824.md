# BL-1112 — coder FF-only instruction (20260824)

## Context

QA bounce `2382cada68` / `BL-1112-qa-bounce-clean-tip-recontaminated-20260824.md`:
coder tip `4524df1ee` is hitchhike-free vs `origin/main`, but the delivered
documenter tip re-merged that line into dirty ancestry (`b80eb8fad` /
`52a1bf2eb`), so `origin/main...<delivered>` still lists ACP/ledger/INTAKE/
done-moves.

## Required merge posture for every downstream role

**Do not** `git merge <this-tip>` into a branch whose
`git diff --name-only origin/main...HEAD` already lists hitchhike paths.

**Do** reset / recreate the role branch on this tip (fast-forward from
`origin/main` through this tip only), e.g.:

```bash
git fetch origin main
git checkout -B swarmforge-<role> <THIS_TIP>
# verify before any handoff to the next role:
git diff --name-only origin/main...HEAD \
  | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8' \
  && echo FAIL || echo CLEAN
```

This tip's surface is standing-reds only (plus this note). Stamp-off asserts
named `&nbsp;` as `pipelineBoard` emits on `origin/main`.

By coder.
