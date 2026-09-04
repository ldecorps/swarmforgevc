# A commit on the shared checkout pushes while it still fast-forwards (BL-1390)

*How-to. Task-oriented: understand why local `main` almost always sits at
`ahead 0` now, and what to check if a QA landing still needs a real merge.*

## The problem this closes

The shared `main` checkout is written by the coordinator (promotes,
closes), the specifier (mints, amendments), the concierge (topic records),
the approval bot (taps), and the operator (config). Every one of those
commits used to sit unpushed until the daemon's periodic push sweep got to
it on its own cadence. The moment QA landed on `origin/main` while
anything local was still unpushed, the checkout was BOTH ahead and behind
at once: the push sweep refuses once diverged, and absorbing `origin/main`
from there becomes a real merge — one the reconcile sweep may only perform
on a clean `merge-tree` verdict (BL-1130/BL-1236) and may never resolve by
reset (BL-1310). Any overlap trips the main-sync deadlock latch, and every
role's prompt forbids the non-fast-forward merge that would clear it, so
it waits for a human.

Measured 2026-09-04: 32 local-only commits accumulated (10 concierge topic
records, 9 coordinator promotes/closes, 5 specifier, 4 operator
hand-merges, 3 approval taps, 1 config), the deadlock latch tripped 115
times in the daemon log, one coordinator close held for 48 ticks, and the
operator hand-merged four times. Nothing had pushed since 14:44Z because
the sweep had been diverged since then.

## The fix: push while it is still cheap

`swarmforge/git-hooks/post-commit` — installed repo-wide via
`core.hooksPath swarmforge/git-hooks`, so it runs after every commit in
every role worktree — pushes a commit on the shared checkout AT ONCE,
while a fast-forward is still possible, rather than waiting for the next
sweep tick. Keeping local `main` near `ahead 0` almost all the time shrinks
divergence to the race window between one local commit and one QA push —
seconds, not a working day — and a QA landing then arrives as pure lag
(`behind>0`, `ahead=0`), which the coordinator's step 0 already absorbs
with `--ff-only` and the reconcile absorbs with no merge at all.

## What the hook does, and does not, do

1. **Decides for itself whether it is on the shared checkout.** The same
   `core.hooksPath` install covers every linked role worktree, so the hook
   must tell them apart: `post-commit-decision` (`push_sweep_lib.bb`)
   returns `:not-shared-checkout` first, before any fetch, whenever the
   commit landed on a role branch or a linked worktree — role branches
   reach `origin/main` only through QA's land, unchanged by this ticket.
2. **Fetches with a short bound**, then pushes only when local `main` is
   strictly ahead of `origin/main` and NOT behind — never diverged, never
   `--force`. If behind, it logs `diverged` and leaves the join to the
   reconcile sweep exactly as before.
3. **Pushes through the ONE existing adapter** (`push-main!` in
   `push_sweep_lib.bb`, BL-1198's one-push-path rule) — the same function
   the daemon's periodic sweep calls, so the hook and the sweep can never
   disagree about whether a push was safe (invariant 3). The hook shells no
   `git push` of its own.
4. **Never fails or stalls the commit.** The whole run is wrapped in a
   bounded `timeout` (default 20s, `SWARMFORGE_POST_COMMIT_PUSH_TIMEOUT`)
   and the hook script exits `0` unconditionally — a post-commit hook
   cannot fail the commit it runs after, but it CAN stall the committer, so
   an unreachable origin, a slow fetch, or a refused push leaves the commit
   exactly as made, logs why, and the periodic push sweep remains the
   fallback (invariant 2) for anything the hook missed.

## Operator controls

| Env var | Effect |
| --- | --- |
| `SWARMFORGE_POST_COMMIT_PUSH=0` | Disables the hook entirely (default `1`, on). The periodic sweep still pushes. |
| `SWARMFORGE_POST_COMMIT_PUSH_TIMEOUT` | Overrides the bound in seconds (default `20`). |
| `SWARMFORGE_POST_COMMIT_PUSH_LOG` | Overrides the log path (default `.swarmforge/daemon/post-commit-push.log`). |

## What to check if a landing still needs a real merge

- Confirm the hook is actually installed: `git config core.hooksPath` on
  the shared master checkout should read `swarmforge/git-hooks`, and
  `swarmforge/git-hooks/post-commit` should be executable.
- Read `.swarmforge/daemon/post-commit-push.log` (or the overridden path)
  for what the last several post-commit runs decided — `diverged` means a
  real two-way divergence had already formed before the commit (the
  ordinary, still-possible case this ticket does not eliminate, only
  shrinks); a missing or empty log around the time in question means the
  hook itself did not run (check `core.hooksPath` and the env toggle
  above).
- The daemon's periodic push sweep is still the fallback of record — this
  ticket adds a faster path, it does not remove the slower one.

## An incident during this ticket's own build: a fixture clobbered the live origin

`test_bl1390_post_commit_push.sh` ran `git -C "$root" remote set-url origin
"$WORK/does-not-exist.git"` with `$root` empty. `git -C ""` leaves the
working directory unchanged rather than erroring, and a linked worktree
shares the live repository's `.git/config` — so the shared
`remote.origin.url` was silently rewritten to a fixture path, and every
push, fetch, and `ls-remote` from every worktree failed until QA found it
(landing BL-1358) and restored the URL at 17:01Z. `set -u` does not catch
an EMPTY variable, only an unset one — the value has to be tested, not
just its existence.

The fix is now a standing engineering guardrail, not just a fixed test: a
test fixture never mutates the live repository. Fixture roots are
`git init`/`git clone` under `mkdtemp`, never `git worktree add` from the
live repository; before ANY mutating git command the test asserts
`git -C "$root" rev-parse --git-common-dir` resolves under the fixture's
own directory (an empty `$root`, or a path inside the live repository,
fails loud before any mutation); and the suite records the live
`remote.origin.url` before it runs and asserts it byte-identical after
(invariant 1, extended after this incident). See the engineering
constitution's Guardrails section for the full incident narrative.

## What this does not change

- Resolving a conflict that has already formed: **BL-1391**, a separate
  ticket.
- The reconcile sweep's own orphaned-merge classification: **BL-1386**,
  **BL-1387**.
- Role worktree branches: they never push, before or after this ticket —
  only QA's land publishes their content.
- The push adapter's own safety rules (BL-630's QA-ancestor gate, BL-1310's
  never-reset-to-resolve rule, BL-891 invariant 1) — this ticket adds a
  new CALLER of the same adapter, never a new way to push.

Acceptance:
`specs/features/BL-1390-a-commit-on-the-shared-main-checkout-is-pushed-while-it-still-fast-forwards.feature`.

## Related

- [Master-Main Reconcile Sweep — Understanding the Note](BL-891-master-main-reconcile-sweep.md) — the sweep this ticket keeps divergence away from needing.
- [Push-sweep caches its refusal and gathers the ahead range once](BL-1085-push-sweep-caches-its-refusal-and-gathers-once.md) — the periodic sweep's own efficiency, unaffected by this ticket's faster path.
