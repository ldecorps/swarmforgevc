# BL-1230: Nested Git-Repository Guard

A check that walks the working tree and reports any git repository nested
inside it that git itself did not put there — the one artifact `git status`
and `git clean` will never surface, because git simply never considers it.
Report only: it never deletes, moves, or rewrites what it finds.

**Last Updated:** 2026-08-29 (BL-1246: git-ignored directories are exempt too)

## Background

`backlog/.git` was found nested in the working tree on 2026-08-28 —
created 2026-08-27 16:51, no remote, no refs, no commits, 3338 backlog
files staged in its index. Suspected the same fixture family as
BL-1196/BL-1200 (a fixture running git against a live path rather than a
temp one), but not proven.

The exposure: `cd backlog && git rev-parse --show-toplevel` returns
`.../backlog`, not the repository root — any script or agent that runs git
with a cwd under a leaked directory silently reads that empty nested
repository instead of the real one. `backlog/` is exactly where the
coordinator runs its `git mv` bookkeeping and the specifier drains intake.
Verified at the time: the parent repo still tracked all 4845 backlog paths
and `git status --short backlog/` was clean — nothing had been lost, only
because git does not convert an already-tracked directory into a gitlink
when a nested repo lands on top of content already tracked. A leak landing
in an untracked directory would not get that luck.

The live `backlog/.git` was removed by a human the same day, per the
swarm's own never-delete-what-you-did-not-create rule — this ticket builds
the check that would have caught it, not the removal.

## How It Works

### The guard — `extension/test/helpers/nestedGitRepoGuard.js`

`findNestedGitRepositories(root, { readdir })` walks the tree from `root`
and reports every `.git` **directory** found, other than root's own.
`readdir` is an injectable seam (default `fs.readdirSync`) so both the unit
suite and the property suite can exercise the walk without a real
filesystem.

Exempt **by construction**, never by naming a known leak path:

- the working tree's own root `.git` — what makes the tree a repository,
  not a nested leak.
- `.git` as a **file**, not a directory (a linked worktree's gitfile, e.g.
  `.worktrees/<role>/.git`, or a submodule reference) — git itself writes
  these; only a real directory redirects git's cwd resolution the way a
  leaked `git init` does.
- anything under `node_modules` — vendored packages may legitimately ship
  their own `.git`.
- the contents of `.worktrees/` — each linked worktree already runs this
  same guard against its own root, so descending into every worktree's
  full checkout from another checkout would be the same "cost grows with
  repo size" shape BL-1038 exists to refuse.
- **(BL-1246) a directory git itself ignores.** `tmp/` is where
  `workflow.prompt` sends every role's scratch, so a role's own git
  fixtures (e.g. a smoke-tested `git init` under `tmp/`) legitimately live
  there — nothing tracked can be swallowed and no bookkeeping runs from it,
  which are the two things that made the original `backlog/.git` leak a
  defect. The exemption is derived from git itself, never a path list: the
  guard asks `git check-ignore --quiet -- <containing-dir>` about the
  directory that holds the nested `.git`, lazily, once per candidate leak,
  and exempts **only** on a clean exit `0`. Exit `1` ("not ignored") still
  reports it; anything else — git missing, the root not a repository, a
  spawn failure — is not an answer and never silences a leak (`git
  check-ignore`'s own exit codes: `0` ignored, `1` not ignored, `128`+
  fatal/unusable). A repository in a **tracked** directory is reported
  exactly as before, including when an ignored one sits right beside it.

The walk never descends into a directory it reports — a leaked repository's
own internals are not this guard's business — and an unreadable directory
is skipped rather than crashing the walk.

### Where it is enforced

`extension/test/nestedGitRepoGuard.test.js` asserts the guard's own
contract (reporting, exemptions, no mutation) and carries the live call
site: `findNestedGitRepositories(root)` against the real repository root,
asserting an empty violation set. It runs in the default unit lane.

`extension/test/nestedGitRepoGuard.property.test.js` encodes all four
declared invariants against generated tree layouts:

- **P1** — the reported set equals exactly the `.git` directory paths
  outside `node_modules`/`.worktrees`, never root's own.
- **P2** — the walk never mutates its input (diffs a JSON snapshot of the
  live node references before/after).
- **P3** (BL-1246) — a nested repository inside a git-ignored directory is
  never reported, across generated trees that always carry both an
  ignored and a tracked branch.
- **P4** (BL-1246) — the report follows the ignore **predicate** itself,
  not a directory name: run against a generator whose `isIgnored` answers
  both ways, a guard that special-cased the name `tmp` instead of asking
  git fails this even though it passes P3.

### Report-only, on purpose

The check never deletes, moves, or rewrites a nested repository. Removal
is a human action — see the human ruling on this ticket. A reported leak
stays present after the check runs; someone acts on the report.

## Scope: a sibling, not a widening

`repoCreationGuard` (BL-1039) scans test **source text** for `git init`
call shapes, to stop per-scenario repository creation. This guard asks a
different question of a different thing — whether a git repository is
already sitting in the tracked tree, regardless of how it got there or
what source line (if any) created it. The two are disjoint by construction
and neither widens the other.

## Human-Facing Surface

None. This closes a working-tree hygiene gap in the unit test lane itself
— no extension command, setting, or UI change.
