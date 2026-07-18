# BL-519 QA Bounce Evidence — parcel contains foreign ticket work

**Stage:** QA · **Date:** 2026-07-18 · **Reviewed parcel commit:** `2e5bab7f` (Merge documenter bbfb270742 (BL-519))

## Verdict: BOUNCE to coder

The parcel received from documenter for BL-519 (`task: BL-519-inline-constitution-into-cacheable-system-prefix`, `commit: bbfb270742`) contains **foreign work from multiple unrelated tickets** (BL-515, BL-521, BL-522, BL-523). This violates **constitution/articles/workflow.prompt → "An Approval Authorizes Only Its Ticket's Work — Don't Forward Foreign, Ticket-less Changes (BL-506)"**: a parcel must carry ONE ticket's task name, and a QA approval authorizes ONLY that ticket's work.

## Failing command
```
cd /home/carillon/swarmforgevc/.worktrees/QA
git diff --name-status main..HEAD
```

## Commit hash
`2e5bab7fc013360441bed0fb825e6c061232bc31` (merge commit in QA worktree after `merge_and_process documenter bbfb270742`)

## First error excerpt
```
A	backlog/evidence/BL-515-bounce-20260718-2.md
A	backlog/evidence/BL-515-foreign-bl519-contamination-20260718-architect-bounce.md
A	backlog/INTAKE-openrouter-provider-support.md
D	backlog/paused/BL-523-openrouter-provider-support.yaml
D	backlog/topics/BL-521.json
D	backlog/topics/BL-522.json
D	specs/features/BL-523-openrouter-provider-support.feature
M	swarmforge/constitution/articles/engineering.prompt
```

## Failure class
`behavior`

## Expected vs observed
Expected: merge commit contains ONLY BL-519 scoped changes (README.md, BL-519 implementation files in swarmforge/scripts/, BL-519 test files, BL-519 acceptance step handlers).
Observed: merge commit additionally contains BL-515 evidence files, BL-521/BL-522 topic deletions, BL-523 intake/cleanup, and a BL-515-related engineering.prompt edit.

## Root cause
The coder's BL-519 implementation commit (`c6db389b`, 2026-07-18 05:42:21) was created on a coder worktree branch that had previously merged architect bounce evidence for BL-515 (`02366c6c` / `2ed13d2d`). The documenter merged that coder commit (`86d12368`) into their worktree, then merged main and created their README update (`bbfb270742`). The documenter's `git_handoff` to QA cites commit `bbfb270742`; QA's merge of that commit into the QA worktree (which already contained BL-515 bounce evidence from its own prior state) results in a merge commit carrying both BL-519 and foreign BL-515/BL-521/BL-522/BL-523 work.

## Remediation required (coder)
1. Rebase the BL-519 coder implementation (`c6db389b` subset) onto a clean base that excludes ALL foreign ticket files (no BL-515 evidence, no BL-521/BL-522/BL-523 changes).
2. Ensure the coder worktree itself contains no foreign ticket artifacts before creating the BL-519 implementation commit.
3. The documenter must similarly ensure their worktree is clean of foreign ticket work before merging the coder's BL-519 commit and adding documentation.
4. Verify before forwarding: `git diff --name-status <clean-base>..<your-commit>` must list ONLY files scoped to BL-519.

By QA.
