# swarmforge-architect worktree anomaly — 2026-08-27

Found while completing the BL-592 bounce (post-merge of cleaner `3cd8e6c173`,
own merge `d4820ef4e`, bounce evidence `364b223bf`).

## Ambient GIT_DIR/GIT_WORK_TREE leak

At session start, plain `git` commands in this worktree silently operated on
the shared `main` checkout (`GIT_DIR=/home/carillon/swarmforgevc/.git`,
`GIT_WORK_TREE=/home/carillon/swarmforgevc` were ambient env vars,
overriding cwd/`.git`-gitlink detection entirely). Already ticketed and
closed as BL-1124 (`backlog/done/M8/BL-1124-property-suite-fixtures-must-not-mutate-shared-main.yaml`)
and documented in a same-day cleaner-session memory note — no new ticket
needed. Worked around for the rest of this session by prefixing every git
invocation with `env -u GIT_DIR -u GIT_WORK_TREE`.

## HEAD tree collapsed to 3 paths (new finding, not yet ticketed as far as I can grep)

With the env leak worked around, `swarmforge-architect`'s actual `HEAD`
(`9d2af028c`) has only 3 paths in its tree (`extension/src/a.ts`,
`src/thing.ts`, `swarmforge/swarmforge.conf`) — confirmed via
`git ls-tree -r HEAD --name-only | wc -l` = 3. Yet `git merge-base
--is-ancestor 364b223bf HEAD` and `... 3cd8e6c173 HEAD` both report
"ancestor" — the rich BL-592 review history (hundreds of files across
`extension/`, `pwa/`, `specs/`, `backlog/`) is a real ancestor of HEAD, but
something between `364b223bf` and `9d2af028c` (a run of `init`/`seed`
commits) collapsed the tracked tree back down to almost nothing.

This blocked the literal git-level revert BL-490/BL-495 calls for after a
bounce: `git revert -n e5cf2a3af4` (the isolated BL-592 coder commit, not
the wider entangled merge) failed with "untracked working tree files would
be overwritten" for all 8 pre-existing files the commit touched
(`bridgeServer.ts`, `consoleMenuUiHtml.ts`, `docsTree.ts`,
`docsTree.test.js`, `pwaDocsExplorer.test.js`, `pwaLocale.test.js`,
`pwa/app.js`, `specs/pipeline/steps/index.js`), and the 3 brand-new files
the commit added (`specTreeUiHtml.ts`, the property test, the new steps
file) do not exist on disk at all.

**Verified safe, not a live-content risk:** diffed each of the 8 blocking
untracked files against the `e5cf2a3af4^` (pre-BL-592) blob — all 8 are
byte-identical to the pre-BL-592 version, matching the known BL-373/BL-924
hot-sync-leaves-untracked-copies pattern (`backlog/done/M8/BL-924-...yaml`).
The working tree already reflects pre-BL-592 content; the rejected BL-592
changes are not live on disk. I did not force-clear the untracked files or
attempt a synthetic revert commit against a 3-file HEAD tree — with the
tree already collapsed to 3 paths, a "clean" revert commit there would be
meaningless bookkeeping, not a real safety improvement, and I was not
willing to guess at destructive tree surgery on a branch already showing
one severe anomaly this session.

## Disposition

- BL-592 bounce to coder sent normally (task
  `BL-592-spec-tree-on-live-console-with-epic-tier-fixture-leak`, commit
  `3cd8e6c173`) — this finding does not change that review or block it,
  per the record-bounce.js contract (best-effort, report-only, never
  gates the send-back).
- Flagging to specifier+coordinator via `note` rather than minting a
  ticket myself, since I could not grep-confirm whether this HEAD-collapse
  is already tracked elsewhere and it may need a human/coordinator to
  inspect worktree health directly rather than have architect guess at
  git surgery.
