# Documenter pass — BL-1294 fixture script closure preserves dependency paths

## Ticket
BL-1294-fixture-script-closure-preserves-dependency-paths

## Hardener tip
756f1bf3cd

## Docs
`docs/reference/BL-1038-pinned-repo-fixture-and-live-derivation-guard.md`
still narrated the pre-BL-1294 contract for `resolveScriptClosure` /
`copyScriptClosure`: a dependency's path reduced to its basename, and an
unresolvable dependency silently skipped rather than failing the build.
Updated the "The fixture" section to describe the current, path-preserving,
fail-loud behaviour, and the "Where it is enforced" section to name the new
`bl1294FixtureClosurePathAndFailureInvariants.property.test.js`. Bumped
"Last Updated" to 2026-09-02 in the same commit as the content change.

`extension/test/helpers/pinnedRepoFixture.js`'s own header/docstring
comments were already brought current by the coder (BL-1240 note,
`copyScriptClosure` docstring) and confirmed accurate against the merged
code — no further in-file comment changes needed.

Checked and found no other user-facing doc, README, changelog, or
`docs/index.md` entry references this fixture's basename/skip behaviour.
No diagram (architecture/swarm-flow/handoff-flow/front-desk-flow) depicts
this mechanism — none of their change-triggers fired.

## Review inventory (Article 4.4)
NONE — one doc-currency defect found (stale reference doc above) and fixed
in this pass; no other defect in this parcel's scope.

By documenter.
