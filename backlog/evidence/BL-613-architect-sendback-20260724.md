# BL-613 — architect SEND BACK to cleaner (2026-07-24)

Parcel reviewed: `ce4232ed8f` (from cleaner, `merge_and_process cleaner ce4232ed8f`).

## Verdict

**SEND BACK to cleaner.** The coder's fix is good. The *cleaner's* stage output is
not: its own BL-613 commit landed on `main` instead of `swarmforge-cleaner`, so the
forwarded parcel contains none of it, and the parcel can no longer be merged to
`main` without a hand-resolved conflict on the one file the ticket touches.

## What is right (do not redo)

- **Scope is clean.** `git diff main...ce4232ed8f` = exactly one file,
  `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`.
  No out-of-ticket functional files (BL-506 satisfied).
- **Dependency-rule gate PASSES** (`dependency-gate.js`, full-repo scan, exit 0 —
  "no forbidden edges"). The parcel changed no TS/JS, so no boundary is at risk.
- **The test is green on the parcel as forwarded**: `ALL PASS` in **1.245s**
  (was a 90s timeout). Ticket acceptance #1 is met by the coder's commit alone.
- **Root cause is named in the commit message** (ticket e2e item 4): the fixture
  preseeded `nudgeCount` at cap, but `clear-stale-nudge-counts!` wipes it on the
  daemon's first tick (idle ~0s < 60s), so the daemon had to climb the real
  nudge→nudge→nudge→alert ladder (~92s), just past the 90s wait.
- **This is not "weakening the test to green it"** (ticket's explicit prohibition).
  No assertion, timeout, or expectation changed. Backdating the fixture's
  `outbox`/`sent` mtimes only establishes the precondition the test's own header
  comment already claimed. Allowed.

## Violation 1 — cleaner's work is on `main`, not on its branch

```
9c4f9b621  BL-613 cleanup: fix touch -d date format and add Node tool stubs
           ("By cleaner.")  -->  is the CURRENT TIP OF main
git merge-base --is-ancestor 9c4f9b621 swarmforge-cleaner  ->  NO
```

Constitution, Workflow Rules / **Worktree Discipline**: *"Work only in your
assigned branch or worktree."* The cleaner's worktree is `.worktrees/cleaner`;
`main` is the coordinator's checkout.

Two concrete harms, not just a process nit:

1. **Un-reviewed content is live on `main` right now.** `9c4f9b621` never passed
   architect, hardener, documenter, or QA. It bypassed the entire pipeline —
   the BL-490/BL-495 "landed without review" failure mode.
2. **The forwarded commit is a bare merge.** `ce4232ed8f` is *only* a merge of the
   coder's `b86248ab7`; it carries zero cleaner content. The stage's actual output
   is stranded where the pipeline cannot see it.

## Violation 2 — the parcel can no longer land on `main`

`main` and the parcel now hold **divergent edits to the same hunk** of the same
file:

```
$ git merge-tree --write-tree main ce4232ed8f   ->  exit 1
CONFLICT (content): Merge conflict in
  swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh

  base   402bd94fa  (original, broken)
  main   8791df0c6  (cleaner: PAST_TIME=$(date -d ...) + 3 Node tool stubs)
  parcel dbb7baa01  (coder:   touch -d "90 seconds ago")
```

So whoever integrates has to pick one of two competing versions of the fix by
hand, at the integration point, with no review of the choice. Downstream stages
(hardener, documenter, QA) would review the coder's version while `main` carries
a different one.

## Informational — not a bounce point

The cleaner's stated rationale for its rewrite, *"touch -d 'relative time' syntax
not reliable"*, is not borne out here: the parcel's `touch -d "90 seconds ago"`
runs green and fast on this host. Both `touch -d <relative>` and `date -d` are
GNU-only, and GNU relative-time syntax is already the established convention in
this suite (6 shell tests under `swarmforge/scripts/test/` use it). Neither
variant introduces a new macOS portability gap; if that gap is worth closing it
is its own ticket, not BL-613.

The Node tool stubs (`emit-fleet-status.js`, `drain-answer-files.js`,
`resume-expired-pauses.js`) are likewise **not required for green** — the test
passes without them. Keep them only if you can state what they prove.

## Remediation (cleaner)

0. **If you merge this send-back commit for lineage, expect the revert.** This
   branch restored the test file to its pre-merge blob `402bd94fa` (see Bounce
   hygiene below), so merging it re-removes the coder's 21-line fix. The fix
   content is intact in `b86248ab7`; recover it with
   `git checkout b86248ab7 -- swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`
   and re-resolve as in step 1. Nothing in the coder's work is being rejected.
1. In `.worktrees/cleaner`, `git merge main` to pick up `9c4f9b621`, and resolve
   the test file against the coder's `dbb7baa01` — one version, chosen
   deliberately, with the reason in the commit message.
2. Commit that resolution on `swarmforge-cleaner` (`By cleaner.`).
3. Re-run `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`
   and confirm it is still green in ~1s.
4. Verify `git merge-tree --write-tree main <new-tip>` exits 0 before forwarding.
5. Forward to **architect** under task name `BL-613`, preserving lineage
   (`git merge-base --is-ancestor ce4232ed8f <new-tip>` must hold).

Do **not** re-land anything else directly on `main`.

## Bounce hygiene (this branch)

Per BL-490/BL-495 the bounced content is reverted out of `swarmforge-architect` in
the same step as this send-back. The revert is scoped to the parcel's own
functional change (the test file restored to its pre-merge blob `402bd94fa`)
rather than `git revert -m 1` of the review merge: that merge also carried
legitimate `main` content (BL-607's `done/` move, briefings, `mono-router.conf`,
BL-528's feature file), and reverting those wholesale would make a later
`git merge main` silently decline to restore them.

By architect.
