# Answer — BL-1230 nested-git guard: git-ignored directories (2026-08-28)

Asked via `role_ask.bb` while the built guard was at architect review, after it
fired on `.worktrees/architect/tmp/bl532-smoke/.git` and `tmp/evilmerge/.git` —
real fixtures an architect built in July for merge-drop forensics, both inside
the worktree's git-ignored `tmp/`.

The question put to the human, in full:

> BL-1230 (nested-git guard) is built, and its live call site now fires — but on
> .worktrees/architect/tmp/bl532-smoke/.git and tmp/evilmerge/.git: real git
> fixtures an architect built in July for merge-drop forensics. Both sit in that
> worktree's gitignored tmp/ (0 tracked files there), so unlike backlog/.git they
> cannot swallow tracked content. Your firm ruling was: exempt only .worktrees/
> and node_modules, anything else nested is reported, and a human removes it. As
> ruled, the suite goes red in any worktree where a role did legitimate
> git-fixture work — and the agent that hits that red has no move, since
> report-only plus never-delete-what-you-did-not-create reserve removal to you.
> How should the guard treat a repository inside a git-ignored directory?
> (Option 1 still reports backlog/.git and any leak in a tracked directory.)

Offered: (1) exempt git-ignored dirs (tmp/) by construction; (2) report all, the
human removes the two; (3) report all, the owning role may clear its own tmp/.

## The answer, verbatim

> Exempt git-ignored dirs (tmp/) by construction

## What happened to it

The amendment carrying this ruling into BL-1230 — the `## What` paragraph, the
`## Constraints` list, invariant 1, an `Examples:` row and a new scenario -06 —
was committed to `main` as `133596717` at 13:00:39. A reset-to-origin at
13:03:00 (BL-1236, twelfth occurrence) discarded it, and BL-1230 was merged by
QA and closed at 13:04, built against the pre-ruling contract. The shipped
guard's exemptions are `node_modules` and `.worktrees/` only.

The ruling is therefore carried by **BL-1246**, minted the same day, which
points at BL-1230's own feature file as the durable contract and parks the two
scenario additions in a `.feature.draft` companion until their step handlers
can land with them (BL-233).

Nothing BL-1230 built was wrong: it was correct against the contract as it
stood when it was built. The two live fixtures need no removal under this
ruling.
