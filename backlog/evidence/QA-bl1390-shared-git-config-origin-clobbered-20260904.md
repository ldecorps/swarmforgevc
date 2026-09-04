# BL-1390's own test fixture clobbered the SHARED repo's `origin` remote — live incident, 2026-09-04

Not a bounce on BL-1390 (not my ticket, not yet reviewed by QA) — a live
production incident report, since it broke git push/fetch to `origin` for
every worktree sharing `/home/carillon/swarmforgevc/.git/`, mine included,
mid-session.

## What happened

Landing BL-1358, `git push origin HEAD:main` (and every subsequent git
network operation from ANY worktree) started failing:

```
fatal: '/tmp/bl1390-post-commit-kTsiBL/does-not-exist.git' does not appear
to be a git repository
fatal: Could not read from remote repository.
```

`GIT_TRACE=1 git ls-remote origin main` showed git correctly attempting
`git-upload-pack '/tmp/bl1390-post-commit-kTsiBL/does-not-exist.git'` — not
a network/auth failure, but the `origin` remote's URL itself:

```
$ git remote get-url origin
/tmp/bl1390-post-commit-kTsiBL/does-not-exist.git
```

The real value should be `git@github.com:ldecorps/swarmforgevc.git` (every
prior push this session used exactly that URL). `.git/config` lives once
per repository and is shared by every linked worktree
(`/home/carillon/swarmforgevc/.worktrees/*`) — `.git/config`'s
`[remote "origin"]` stanza is not worktree-scoped. A test fixture path
named `bl1390-post-commit-*` strongly implicates BL-1390's own coder pass
(observed running concurrently in `.worktrees/coder` throughout this
session — `specs/pipeline/test/bl1358MutantTimeCeiling.test.js` and
BL-1390's own generated tests were both live at points during this QA
pass) as the source: a test exercising "a commit on the shared main
checkout is pushed" evidently points a real `git remote set-url origin
<fixture-path>` (or equivalent) at the SHARED repo config instead of an
isolated fixture clone, and either never restores it or was killed
mid-test before its own cleanup ran.

## Impact, this session

- My own `git push origin HEAD:main` for BL-1358's land silently failed at
  the network step (the wrapping `land_main_publish.sh --release-lock`
  step still reported `LOCK_RELEASED` since it doesn't verify the push;
  the push's own failure was visible only in its own stderr, which I read
  before trusting the sequence complete). Caught before reporting BL-1358
  landed — `git ls-remote origin main` confirmed `origin/main` was still at
  the prior commit, not mine.
- Every OTHER git network operation from ANY worktree in this repo — any
  concurrent `git fetch`/`git push`/`git ls-remote` by the coordinator,
  specifier, or another role — would have failed identically for the
  duration the config stayed clobbered. Not verified how long that window
  was or whether any other role's own action was silently dropped by it;
  flagging for the coordinator to check its own operation log for the same
  window.

## Fix applied (this session, to unblock landing)

```
git remote set-url origin git@github.com:ldecorps/swarmforgevc.git
```

Verified: `git ls-remote origin main` resolved correctly immediately
after. BL-1358 then landed cleanly (`485fd43bce`).

## What still needs doing (not mine to do — flagging, not fixing BL-1390)

1. BL-1390's own test suite must never write to the SHARED repo's
   `.git/config` — its fixture must be an isolated clone/worktree with its
   own `origin`, matching this repo's own engineering guardrail (`Test
   Speed And Isolation`: "stub `process.cwd()`/`os.homedir()`... redirect
   through env seams", and the master-checkout shared-hazards discipline
   generally). If the current failing form ever ran to completion without
   restoring `origin`'s URL afterward, that is BL-1390's own defect to fix,
   not something QA should patch in this ticket's own land.
2. Whoever reviews BL-1390 (architect/hardener/QA when it reaches them)
   should specifically check for this: does ANY test in that ticket's diff
   touch the shared repo's real `origin` remote rather than a
   fixture-local one, and does it restore state in a `finally`/trap either
   way.

By QA.
