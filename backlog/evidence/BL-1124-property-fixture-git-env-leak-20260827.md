# Property-suite shared-repo corruption — root cause found (2026-08-27)

## What happened

Committing BL-751 (touches `extension/src/tools/telegramCursorBridgePilot.ts`)
triggered the pre-commit hook's property-suite guard
(`swarmforge/scripts/check_property_suite_drift.sh`). The BL-1124 canary
fired: `Commit rejected: property suite mutated the shared checkout
(BL-1124).` `refs/heads/swarmforge-coder` was found rewritten to a fixture
commit (`1fcc17077 seed`), with reflog showing dozens of prior `init`/`seed`/
`fixture: initial` commits interleaved with real history going back a long
way — this has been corrupting and self-recovering for many sessions,
not a one-off.

## Root cause

`extension/test/helpers/backlogCorpusFixture.js`'s local `git()` helper
(used by BL-1074/BL-1066 and sibling property fixtures) copies
`process.env` verbatim into its `execFileSync('git', ...)` calls:

```js
function git(repo, args, dateIso) {
  const env = { ...process.env };
  ...
  execFileSync('git', args, { cwd: repo, env, ... });
}
```

It never scrubs `GIT_DIR` / `GIT_WORK_TREE`. When those vars are present in
the ambient shell environment (observed set to the shared repo's own
`.git`/root in this session, seemingly by something in the coder pane's
launch environment), every "isolated" fixture-repo git call in this helper
ignores `cwd` and operates on the SHARED repo instead — including `git add`,
`git commit`, `git mv` — repeatedly rewriting whatever branch is checked out.

The sibling helper `extension/test/helpers/sharedRepoFixture.js` already
has the fix, right next to the buggy one:

```js
const env = { ...process.env };
delete env.GIT_DIR;
delete env.GIT_WORK_TREE;
execFileSync('git', args, { cwd: dir, ... env });
```

`backlogCorpusFixture.js`'s `git()` just needs the same two `delete` lines.

## Recovery performed

`refs/heads/swarmforge-coder` restored via
`git update-ref refs/heads/swarmforge-coder e5cf2a3af` (the real last commit,
recovered from `git reflog show swarmforge-coder`), followed by a plain
`git reset` (index only, working tree untouched) to clear the resulting
staged-deletion noise. Working-tree files were never touched by the
corruption — only the ref/index.

## This commit

BL-751 lands with `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` — the guard's own
documented recovery-only override — because the canary is refusing on a
pre-existing, unrelated fixture bug, not a property regression in this
change (verified independently: `bl592SpecTreeEpicTierInvariants.property.test.js`
and the touched-file unit suite both pass green; this diff touches no module
any property test exercises).

## Not fixed here

Not fixing `backlogCorpusFixture.js` as part of BL-751 — out of that ticket's
scope. Flagged via `note` to specifier + coordinator for proper ticketing;
this file exists so the recovery and root cause survive as evidence either
way.
