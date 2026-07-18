# BL-519 QA Bounce Evidence — parcel contains foreign ticket work (BL-515/BL-521/BL-522/BL-523)

**Stage:** QA · **Date:** 2026-07-18 · **Reviewed parcel commit:** `97d0ccae4ff1bee991114685827b10ecce8b8441`

## Verdict: BOUNCE to coder

The parcel received from documenter for BL-519 (`task: BL-519-inline-constitution-into-cacheable-system-prefix`, `commit: 97d0ccae4f`) contains **foreign work from multiple unrelated tickets** (BL-515, BL-521, BL-522, BL-523). This violates **constitution/articles/workflow.prompt → "An Approval Authorizes Only Its Ticket's Work — Don't Forward Foreign, Ticket-less Changes (BL-506)"**: a parcel must carry ONE ticket's task name, and a QA approval authorizes ONLY that ticket's work.

## Failing command
```
cd /home/carillon/swarmforgevc/.worktrees/QA
git diff --name-status main..97d0ccae4ff1bee991114685827b10ecce8b8441
```

## Commit hash
`97d0ccae4ff1bee991114685827b10ecce8b8441`

## First error excerpt
```
D	backlog/evidence/BL-515-bounce-20260718.md
D	backlog/paused/BL-523-openrouter-provider-support.yaml
D	backlog/topics/BL-521.json
D	backlog/topics/BL-522.json
D	backlog/evidence/BL-515-bounce-20260718-2.md
D	specs/features/BL-523-openrouter-provider-support.feature
M	swarmforge/constitution/articles/engineering.prompt
```

## Failure class
`behavior`

## Expected vs observed
Expected: merge commit contains ONLY BL-519 scoped changes (cache_warm_*.bb, agent_runtime_*.bb, swarmforge.sh cache changes, BL-519 acceptance step handlers, README.md updates, BL-519-specific test files).
Observed: merge commit additionally contains deletions of BL-515 evidence files, BL-521/BL-522 topic deletions, BL-523 intake/cleanup, and a BL-515-related engineering.prompt edit that removes BL-515-specific content.

## Root cause
The coder's BL-519 cleanup commit (`02957644`, "BL-519: clean coder worktree of foreign ticket artifacts") deleted artifacts from other tickets (BL-515 evidence files, BL-521/BL-522/BL-523 backlog/topics/feature files) that had contaminated the BL-519 branch. These deletions, while necessary for cleanup, are foreign to BL-519's scope (which is "inline constitution+PIPELINE into a cacheable stable-first bootstrap prefix" + cache-warm/rebuild). Per BL-506, a parcel must contain ONLY its ticket's work; cleanup of foreign contamination must be done in the coder's worktree BEFORE the ticket's implementation commit, not bundled into it. The contamination deletions now travel with BL-519's forward chain and would be authorized by a BL-519 QA approval despite belonging to other tickets.

## Remediation required (coder)
1. Create a clean BL-519 implementation branch that excludes ALL foreign ticket artifacts (no BL-515 evidence, no BL-521/BL-522/BL-523 changes).
2. Re-apply the BL-519 implementation (cache_warm_*, agent_runtime_*, swarmforge.sh, step handlers) onto this clean base.
3. Ensure the BL-519 README update is also on the clean base.
4. The BL-515/BL-521/BL-522/BL-523 cleanup must be a separate concern: if those tickets are abandoned, their artifacts should be cleaned up in a dedicated housekeeping ticket, not smuggled into BL-519.
5. Verify before forwarding: `git diff --name-status <clean-base>..<your-commit>` must list ONLY files scoped to BL-519 (cache_warm_cli.bb, cache_warm_lib.bb, agent_runtime_cli.bb, agent_runtime_lib.bb, swarmforge.sh, specs/pipeline/steps/bl519InlineConstitutionCacheSteps.js, specs/pipeline/steps/index.js, specs/features/BL-519-inline-constitution-cache.feature, README.md, swarmforge/scripts/test/*cache_warm*, swarmforge/scripts/test/test_agent_runtime_*).

By QA.
