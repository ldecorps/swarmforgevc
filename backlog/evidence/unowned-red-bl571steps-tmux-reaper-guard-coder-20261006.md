# Unowned red: tmuxReaperGuard flags bl571SequentialRotationDormantParitySteps.js

Found by the coder (BL-1982 work, branch `swarmforge-coder@2`) while running
`npm test` in `extension/` before forwarding BL-1982. Not caused by this
parcel - `specs/pipeline/steps/bl571SequentialRotationDormantParitySteps.js`
was never touched on this branch.

## Failure

`extension/test/tmuxReaperGuard.test.js > the real specs/pipeline/steps tree
has zero tmux-reaper violations`:

```
specs/pipeline/steps/bl571SequentialRotationDormantParitySteps.js: can cause
a tmux server to run but does not require ./lib/fixtureReaper and call
track()
```

## Cause (observed, not yet adjudicated)

Hotfix `c15a0f21aa` (2026-10-06, stamp-off ticket BL-2018, currently in
`backlog/paused/`) added a `new-session` branch to this file's fake-tmux
heredoc so the fixture also counts a created session as a repair (BL-571
scenario 03). That addition appears to be what now trips
`tmuxReaperGuard.test.js`'s static hazard scan - BL-2018's own
`qa_e2e_procedure` only re-runs the BL-571 feature and
`test_handoffd_supervisor.sh`, neither of which exercises this vitest guard,
so this third red from the same hotfix was not caught by BL-2018's review
scope.

Reproduced on `main`/`origin/main` at d885cdfcba (this branch's merge base),
unrelated to BL-1982.

## Register

No row in `backlog/standing-reds.tsv` for this file/assertion as of this
commit.

By coder.
