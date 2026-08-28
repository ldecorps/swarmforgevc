# BL-1230 hardener pass — 2026-08-28

## Fixture leak fixed
`bl1230NestedGitRepoGuardSteps.js`'s `a repository working tree` Background
step created a fixture root via `fs.mkdtempSync` with no cleanup anywhere in
the file — a pure leak on every scenario, pass or fail. Confirmed: 28
pre-existing `bl1230-tree-*` dirs already in `/tmp` before this pass (from
the earlier passes' own acceptance runs). Fixed with the standing
`registerFixtureRoot` + `process.on('exit')` + eager-Background-removal
pattern (BL-529/BL-971), same shape as BL-1228's fix earlier today. Cleared
the pre-existing leaked dirs (same fixture-prefix class as my own fix
introduces) and re-ran: 7/7 green, 0 leaked dirs.

## Mutation hardening (hand-authored)
`extension/test/helpers/nestedGitRepoGuard.js` is a test-helper module
(`extension/test/helpers/`), not `extension/src/**`, so Stryker/CRAP/DRY
don't scope it — matching this ticket's own sibling guards
(`repoCreationGuard`, `tempDirTrapGuard`). The coder's own hand-mutation
pass (recorded in the ticket's notes) confirmed the two declared invariants'
property tests catch a broken root-`.git` exemption and an in-walk mutation.

I ran one additional hand mutant the existing suite (12 unit + 3 property
tests at the time) did not cover: removing the `continue` after handling a
`.git` entry, so the walk falls through to the generic `isDirectory()`
recursion and descends into a leaked repository's own internals — exactly
what the code comment says must never happen ("never descend into a
repository (leaked or legitimate)"), but nothing asserted it. The mutant
SURVIVED the full existing suite (12/12 unit + 3/3 property tests still
green with the mutation applied).

Root cause of the gap: a leaked repo's own internals essentially never
contain a literal `.git`-named directory in practice, so no existing fixture
could discriminate the mutant without deliberately planting one. Added
`extension/test/nestedGitRepoGuard.test.js`: "a leaked repository's own
internals are never walked" — plants a `.git` directory inside the leaked
repo's own `.git/modules/x/` tree and asserts the walk reports only the
outer leak. Verified non-vacuous by hand: the mutant (continue removed)
turns this test red (`['backlog/.git', 'backlog/.git/modules/x/.git']`
vs the expected `['backlog/.git']`); restoring the code turns it green
again. No other mutation gaps found in a manual sweep of the remaining
branches (all already covered per the existing 12 unit + 3 property tests
and the coder's own recorded hand-mutation pass).

Full suite for this ticket: `nestedGitRepoGuard.test.js` 13/13 (was 12,
+1 new),  `nestedGitRepoGuard.property.test.js` 3/3, acceptance 7/7.

## Cleanup
No orphaned test/mutation/tmux processes. All hand-mutation probes reverted
(`diff` confirmed byte-identical to the pre-probe file before and after);
only the intended test-file addition and the fixture-leak fix remain in the
diff.

By hardener.
