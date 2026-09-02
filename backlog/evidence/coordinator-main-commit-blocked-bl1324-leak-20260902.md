# Coordinator — main refuses ALL commits (BL-1324 registration leak)

Date: 2026-09-02 · Discovered while bookkeeping BL-1314's QA approval.

## What's wrong

`specs/pipeline/steps/index.js:919` on `main` (HEAD `c65d8e6728`) has:

```
require('./bl1324ClaudeSeatQwenCloudContextWindowSteps'),
```

but `specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js`
does not exist on `main` — it only exists in worktrees (coder, cleaner,
architect, hardener, documenter, QA), because **BL-1324 is still mid-pipeline
and has not landed** (`backlog/active/BL-1324-...yaml`, `required_wiring`
names this exact line as work BL-1324 itself is supposed to add on landing).

`swarmforge/git-hooks/pre-commit` runs
`swarmforge/scripts/check_feature_handler_registration.sh`, which refuses
**any** commit while a required registry module is missing/unreadable. Since
this is now true of `main`'s own working tree, every role — every commit,
not just mine — is blocked until this is fixed. Verified directly:

```
$ swarmforge/git-hooks/pre-commit
Commit refused: a feature file would reach `main` with no runnable step handler.
  - missing or unreadable registry module: specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js
```

## How it got there

`git diff 6097b4040a c65d8e6728 -- specs/pipeline/steps/index.js` shows
`c65d8e6728` (BL-1314's land-step "tip-pure replay", `land_step_cli.bb`,
BL-1241 remedy) added BOTH:
```
+  require('./bl1324ClaudeSeatQwenCloudContextWindowSteps'),
+  require('./bl1314InvariantTwoQaQuestionSteps'),
```
QA's own evidence (`backlog/evidence/BL-1314-qa-pass-20260902.md`) explicitly
says the replay diff contains "no BL-1324 ... content" — but this one line,
adjacent in the same shared file, rode along anyway. QA's entangled-sibling
handling (BL-1241) caught the *commits*; it did not catch this
*line-level* leak inside a file both tickets happen to edit.

## Suggested remedy (specifier to adjudicate — not self-run)

Revert just the `bl1324ClaudeSeatQwenCloudContextWindowSteps` require line
from `specs/pipeline/steps/index.js` on `main` (leaving the
`bl1314InvariantTwoQaQuestionSteps` line, which IS legitimately landed and
has its handler file present). This restores main to the state QA's own
evidence describes as intended. BL-1324 re-adds the same line itself,
correctly, when it lands with its handler file.

This is a swarm-delivery-machinery defect (Article/pipeline "same gates, no
machinery" — main cannot accept the very commit that would fix it) — small
enough that a full expedite.sh run may be overkill, but the decision is the
specifier's/human's, not mine. I have not touched `specs/pipeline/steps/index.js`.

## Impact while unresolved

- No role can commit to `main` for ANY reason (backlog bookkeeping included —
  my own BL-1314 close is currently blocked by this, files staged but
  uncommitted: `backlog/active/BL-1314-...yaml` -> `backlog/done/M8/...yaml`).
- This likely explains the otherwise-unexplained pipeline quiet at this
  wake-up (all worktree role inboxes empty/current) — no role can land forward
  progress right now.

By coordinator.
