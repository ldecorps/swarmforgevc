# BL-1246 — the git-ignored-directory exemption, built and measured

Coder, 2026-08-29. Evidence for the `qa_e2e_procedure`, plus one correction to
the ticket's stated rationale that a reviewer should see.

## qa_e2e walked

| step | result |
|---|---|
| 1. `git init` inside a TRACKED subdirectory of a scratch checkout | pass — still reported as `backlog/.git` |
| 2. add a directory to `.gitignore`, `git init` inside it | pass — nothing reported |
| 3. both present at once | pass — `backlog/.git` reported, nothing under `tmp/` |
| 4. `.worktrees/<role>/.git` and repositories under `node_modules` | pass — the three BL-1230 exemptions are untouched and still covered by their own tests |
| 5. run against the LIVE `.worktrees/architect` | **pass — zero violations, with `tmp/bl532-smoke/.git` and `tmp/evilmerge/.git` still on disk** |

Step 5, verbatim:

    architect worktree violations: []
    coder worktree violations: []

Both fixtures are still present; nothing was deleted, moved or rewritten,
which is the ruling's own firm line and the swarm's never-delete rule.

## Derived by construction, verified as such

The exemption asks `git -C <root> check-ignore --quiet -- <dir>` about the
directory CONTAINING the nested `.git`, and exempts ONLY on a clean exit 0.
Exit 1 is "not ignored"; anything else — git missing, not a repository, a
spawn failure — is not an answer, and an unanswered question never silences a
leak. A unit test pins that: a root that is not a repository at all still
reports the nested repo inside it.

It is asked lazily, once per candidate leak rather than once per directory
walked — the walk visits thousands of directories and finds a nested `.git`
essentially never, so this is one spawn per report, not per node.

That the exemption is the PREDICATE and not a name is pinned twice: a unit
test where `tmp/` is NOT ignored (rule is `/build/`) and the repository inside
it is still reported, and a property (P4) that runs the same tree with the
predicate answering both ways and asserts the report follows the predicate.
A guard that special-cased the name `tmp` passes P3 and fails P4 — verified by
making exactly that break.

## One correction to the ticket's rationale

The "How" section says: *"git never considers a `.git` path against ignore
rules, so `check-ignore tmp/evilmerge/.git` tells you nothing while
`check-ignore tmp/evilmerge` answers."*

Measured on the git in this environment, that is **not reproducible**. Under a
rule that ignores the parent (`/tmp/`, `evilmerge`, or `/tmp/evilmerge/`),
`check-ignore` answers *ignored* (exit 0) for `tmp/evilmerge/.git` too:

    tmp/evilmerge      -> exit=0
    tmp/evilmerge/.git -> exit=0

The DIRECTION is still right and is what shipped: the guard asks about the
containing directory, because that is the thing being exempted and the
question with a well-defined answer, and it stays correct on any git that does
refuse to answer for `.git` paths. Only the justification is inaccurate. A
test asserting the ticket's literal claim was written, found to fail, and
replaced with one pinning the behaviour the guard actually relies on — the
claim is recorded here rather than quietly dropped.

## Draft promotion (BL-233)

`specs/features/BL-1246-ignored-directory-is-not-a-leak.feature.draft` is moved
into the live contract in this same commit as its handlers: one extra Examples
row on scenario -02 (title widened with it, as the draft directs) and the new
scenario -06. The draft file is removed. The ticket's `acceptance:` already
points at BL-1230's feature file, so no pointer flip was needed.

Acceptance: 9/9 (was 8 — the new row and scenario -06 both run).

## Invariants

Both are executable in `extension/test/nestedGitRepoGuard.property.test.js`
(P3, P4), alongside BL-1230's P1/P2 rather than in a fork of them. Every
generated tree carries BOTH an ignored branch and a tracked branch by
construction — the failure both invariants guard against lives at that
boundary, and a tree with only one kind reaches nothing — with an asserted
floor on the both-kinds-at-once state specifically, since a run that never
generated both would pass P3 while saying nothing about invariant 2.

Non-vacuity, both shown and restored: exempting unconditionally fails P3 (4
failures), and name-matching `tmp` instead of the predicate fails P4.

## Suite

Guard unit tests 22/22 (13 pre-existing + 9 new). Full unit suite unchanged
from baseline: 20 failing files, 33 failing tests, none of them this parcel's.
