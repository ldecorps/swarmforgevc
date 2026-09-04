# BL-1399 — possible dropped-work on `main`, found during cleaner merge-up, 2026-09-04

## Finding

Merging QA's land commit `7b3d2108fc` ("BL-1399: tip-pure land -- own paths
only, replayed onto origin/main") into my cleaner worktree produced add/add
conflicts against content this branch already carried (via an earlier
merge of the coder's BL-1393 work, which itself carried BL-1399's fully
amended state). Diffing the two sides showed the land's content is
MISSING the specifier's amendment:

- `specs/pipeline/steps/bl1399FreshnessFixtureOwnRegistrySteps.js`: land
  lacks the `rows-derived` / `rows-match-glob` step definitions and their
  `requirePassed` assertions.
- `swarmforge/scripts/test/test_bl1399_freshness_fixture_own_registry.sh`:
  land lacks the amendment's e2e checks 4b/4c (dropping a derived
  supervisor row makes the guard refuse; the fixture's row set equals the
  live glob's basenames at test time).
- `backlog/evidence/BL-1399-coder-20260904.md`: land lacks the "Follow-up
  after the specifier's amendment" section.

Confirmed live right now: `git show origin/main:specs/pipeline/steps/bl1399FreshnessFixtureOwnRegistrySteps.js`
has zero occurrences of `rows-derived`/`rows-match-glob`. The ticket is
still `status: todo` in `backlog/active/`, not `done/`.

## Timeline (from `git log`, all times 2026-09-04 local)

- 21:22:45 — QA bounce evidence: "Background step regex stale vs
  specifier's in-flight amendment" (`152bae1089`)
- 21:23:26 — QA merges hardener's D1 bounce-fix into the QA worktree
  (`3c384453a3`) — **this is QA branch's last commit touching this file**
- 21:25:29 — coder adopts the specifier's amendment (`01d04e31e3`)
- 21:34:55 — hardener re-verifies the amendment, e2e 8/8 including the new
  2b checks, explicitly "Forwarding to QA, superseding earlier forward
  2ecdd6341e" (`71711272be`)
- 21:52:03 — QA records `bounce_history` on the ticket YAML (`174391df60`)
- 22:14:08 — QA lands `7b3d2108fc`, "tip-pure ... replayed onto
  origin/main" — but its content matches the 21:23 state, not the 21:34
  superseding one
- 22:19:24 — QA records `abandoned_commits` and land-escalate evidence
  (`b2f822150d`)

The hardener's 21:34:55 forward explicitly superseded the 21:23 state.
QA's land appears to have been computed from a stale "last handoff commit"
that predates that supersession, and the superseding work seems to have
been treated as an `abandoned_commits` sibling rather than merged in
before landing — the same class of issue flagged in this swarm's memory as
"abandoned_commits must list actual last-handoff-commit" and "LAND_ESCALATE
sibling list inflated by replay landed/done tickets."

## What I did

Resolved my own merge-up conflict (the coordinator's "branch behind
7b3d2108fc" note) by keeping this branch's fuller, amendment-including
content for all three conflicting files rather than the land's — taking
the land's version would have actively reverted already-hardened,
already-forwarded work in my own branch. Verified
`test_bl1399_freshness_fixture_own_registry.sh` still 8/8 PASS after.

**Not fixed here**: `main`/`origin/main` themselves still carry the
pre-amendment content — that requires a proper re-land or hand-splice,
which is QA's/the coordinator's call, not something I should reach into
from a cleaner merge-up. Flagging so QA can correct the land or the
coordinator can route it.

By cleaner.
