# record-bounce.js false-positive "violation" on legit recovery commit (2026-08-27)

## Trigger

Resending the BL-1188 bounce to coder (never delivered, per coordinator note
`swarmforge-architect fully recovered 0bf05774a, deletion diff empty`) from
the recovered tip `0bf05774ac`, per `record-bounce.js`'s own required
protocol:

```
node extension/out/tools/record-bounce.js --ticket BL-1188 --role coder \
  --type defect --class behavior --commit 0bf05774ac --by architect \
  --evidence backlog/evidence/BL-1188-architect-bounce-20260827.md
```

## What happened

The command succeeded (`recorded: true`, exit 0), but its `revertCheck`
block reported `"verdict": "violation"` with remedy `git revert --no-edit
0bf05774ac`, naming 13 `liveFiles` (`specTreeUiHtml.ts`,
`bl1188PipelineGridLiveStageParitySteps.js`, the BL-1188 feature file, the
BL-1184/BL-428 backlog yamls, etc.) as matching content from an earlier
bounce-revert (`4188b77e0`/`1fcd4c167`, "revert bounced coder content out
of architect branch (BL-490/BL-495)").

## Why this is a false positive here

`0bf05774a` is coordinator's documented 13-file recovery commit (see
`architect-recovery-froze-a-silent-file-loss-20260827.md`), restoring
content that the tree-collapse incident (this session, see
`architect-branch-severely-collapsed-tree-20260827.md`) had silently
dropped from disk in this worktree — not a re-application of a rejected
coder fix. Coordinator independently confirmed this commit's deletion diff
against the pre-corruption baseline is EMPTY (pure restoration, nothing
overwritten or reverted-back). The tool has no notion of the session-wide
corruption incident, so it cannot distinguish "bounce content silently
reappearing via a bad merge" (the real hazard it's designed to catch, e.g.
BL-954) from "physically-lost files restored from a known-good sibling
branch."

Confirmed independently before treating this as anything but a false
alarm: `bl1188PipelineGridLiveStageParitySteps.js` at `0bf05774a` still
has the exact D2 defect from the original bounce (leaked `mkdtempSync`
fixture dir, no `afterEach`/`finally` cleanup) — i.e. this is genuinely the
pre-fix, never-delivered-to-coder state, exactly matching what the
"never delivered, please resend" note described. Reverting `0bf05774ac`
would re-lose all 13 files, including entirely unrelated legitimate
restorations (e.g. `specTreeUiHtml.ts` for BL-592), re-triggering the
incident that was just fixed.

## Disposition

- NOT acting on the suggested `git revert` remedy.
- Proceeded to bounce BL-1188/D2 to coder from `0bf05774ac` as instructed.
- Flagging to specifier + coordinator as a note (not a bounce — this is a
  tooling-accuracy gap, not a defect in either parcel) so another role
  doesn't blindly follow the revert remedy in a similar recovery-adjacent
  situation.
