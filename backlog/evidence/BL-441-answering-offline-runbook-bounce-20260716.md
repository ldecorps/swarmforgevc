# BL-441 QA bounce — 2026-07-16

## Failing command
./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-441-answering-offline-runbook.feature

## Commit hash tested
7905e2919e1b78864ce8b52dfcfd749e732775e6 (documenter's handoff commit, merged into QA worktree as part of this verification)

## First error excerpt
/home/carillon/swarmforgevc/.worktrees/QA/specs/features/BL-441-answering-offline-runbook.feature (No such file or directory)
Error: Command failed: bb gherkin-parser /home/carillon/swarmforgevc/.worktrees/QA/specs/features/BL-441-answering-offline-runbook.feature /tmp/aps-ir-5UGO7J/ir.json
/home/carillon/swarmforgevc/.worktrees/QA/specs/features/BL-441-answering-offline-runbook.feature (No such file or directory)

    at genericNodeError (node:internal/errors:983:15)
    at wrappedFn (node:internal/errors:537:14)
    at checkExecSyncError (node:child_process:916:11)
    at execFileSync (node:child_process:952:15)
    at parseFeatureFile (specs/pipeline/runnerAdapter.js:21:5)
    at runPipeline (specs/pipeline/runnerAdapter.js:48:25)

## Failure class
acceptance

## Expected vs observed
Expected: the ticket's own `acceptance.feature` field (backlog/active/BL-441-answering-offline-runbook.yaml)
names `specs/features/BL-441-answering-offline-runbook.feature`, a live, runnable Gherkin file, per BL-112's
mandatory final acceptance gate. Observed: only the non-executable
`specs/features/BL-441-answering-offline-runbook.feature.draft` companion exists — the coder's own commit
message (bab3abd520) flagged this explicitly ("still needs materializing into a live .feature by the
specifier before QA's acceptance gate can run it"), but no later stage (cleaner, architect, hardener,
documenter) did so, and the coordinator's promotion commit (526c1274) only moved the backlog yaml, not the
draft. QA cannot run its mandatory acceptance gate against this parcel as a result.
