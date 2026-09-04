# BL-1390 — CODER REWORK, 2026-09-04

Bounce accepted in full. Class: behavior (test isolation). Producer: coder —
mine, without qualification.

## What I did

`test_bl1390_post_commit_push.sh` line 184 ran `git -C "$root" remote set-url
origin <fixture path>` with `$root` empty. `git -C ""` does not fail — it uses
the current directory — and a linked worktree shares the live `.git/config`,
so the SHARED repository's `remote.origin.url` was rewritten to
`/tmp/bl1390-post-commit-*/does-not-exist.git`. Every push, fetch and
`ls-remote` from every worktree failed until QA restored it at 17:01Z.

I had already hardened `g`/`gq`/`commit_on` against exactly this after the same
mechanism committed to this branch earlier in the parcel — and left this ONE
call outside the guard. A guard with an exception is not a guard.

## What changed now

- **Every** git invocation in the suite goes through one guarded helper. There
  is now exactly ONE raw `git -C` in the file: the guard's own question, which
  cannot route through itself. The suite asserts that count structurally, so a
  future unguarded call fails the test rather than the repository.
- The guard no longer trusts the path string. It PROVES the target with
  `git rev-parse --git-common-dir` and refuses unless that answer is under the
  fixture's temp root — the amendment's own wording, and the check whose
  absence let a live-worktree path pass for a fixture.
- Scenario 06: the live repository's origin URL and worktree list are recorded
  before the suite runs and compared after; both must be byte-identical.
- The worktree scenario names its branch for this fixture and removes the
  registration itself (`worktree remove --force`, `prune`, `branch -D`).

## Verification

- `test_bl1390_post_commit_push.sh` — **ALL PASS**, now 17 checks including the
  three new ones. Confirmed after the run: `git config --get remote.origin.url`
  is `git@github.com:ldecorps/swarmforgevc.git`, unchanged.
- Acceptance on the amended feature: **6/6**, scenario 06 included.
- `bl1390_post_commit_push_property_runner.bb` and
  `push_sweep_lib_test_runner.bb` — unchanged and still green; the hook itself
  was not modified by this rework, only its test.

## Two traps this cost, recorded so the next reader pays neither

1. `git -C ""` silently means "here". Any fixture helper that can receive an
   empty path is one bug away from operating on the live repository.
2. My own bulk rewrite of `git -C "$X"` → guarded helper also rewrote the
   guard's internal call, so the guard recursed and refused every fixture. The
   suite's "exactly one raw git -C" assertion is what makes the correct shape
   visible rather than a matter of care.

By coder.
