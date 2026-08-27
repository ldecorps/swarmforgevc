# BL-630 QA bounce — 2026-07-30 (round 3, at QA)

## D1: Hardener pass missing entirely

**Failing command**: no command — inspected the commit lineage directly:

```
git log --oneline 62e80cbbe..b8433cc1a
git log --oneline 325add9f3..b8433cc1a -- swarmforge/scripts/push_sweep_lib.bb swarmforge/scripts/handoffd.bb
```

**Commit hash**: `79a03c13f` (QA's own merge of the documenter's `b8433cc1a`,
which the `git_handoff` named; parent chain traced back through
`62e80cbbe` — architect's merge of the coder's bounce-#2 rework — to the
ticket's first coder commit `325add9f3`).

**First error excerpt** (the load-bearing evidence): walking every commit
between the architect's final approval merge (`62e80cbbe`) and the
documenter's commit (`b8433cc1a`) turns up exactly one intervening commit,
and it belongs to a *different* ticket (`b0b366192`/`6297db3f9`, BL-686
hardening — present only because the two tickets' branches share history).
Restricting to commits that touch this ticket's own files
(`push_sweep_lib.bb`, `handoffd.bb`) across the ticket's ENTIRE lifetime
(`325add9f3..b8433cc1a`, not just this last round) surfaces only two commits,
and both are the coder's own bounce-fix commits (`4f6c74a17`, `969dea9f0`) —
no commit anywhere touches these files as a distinct hardening pass.

**Failure class**: `behavior`

**Expected vs observed**: Expected a genuine hardener pass — this project's
own documented posture for `.bb`/Babashka swarm scripts (`engineering.prompt`'s
Startup Tools section) is that mutation/CRAP/DRY tooling is not wired for
`.bb` files, so the hardener's actual gate there is the file's own unit-test
suite (`swarmforge/scripts/test/`) — a degraded gate, not an absent one. BL-675
(shipped two days earlier, also a pure `.bb` defect fix) got exactly that:
two real hardener commits (`33f297685` "harden freshness checker against
work-only lies and pid-1 kill", `7d0f415bf` "harden cool-off epoch parse
against empty sed match") that found and closed edge-case gaps in the
existing unit-test-only gate. Observed: BL-630 has no hardener-authored
commit anywhere in its history; the pipeline went coder → cleaner →
architect (two bounce rounds) → documenter, with the hardener stage skipped
entirely.

This matters more than a formality here specifically because this ticket's
own history is two rounds of the architect finding subtle git-semantics
correctness bugs the coder's and each other's tests didn't catch (bounce #1:
`git diff-tree` returns no paths for ANY merge; bounce #2: the bounce-#1 fix
then exempted merges with real hand-resolved-conflict content too). A
`.bb`-degraded hardening pass is exactly the kind of second independent look
— combing `push_sweep_lib.bb`'s `qa-gate-decision` and `handoffd.bb`'s
`ahead-commit-facts`/`git-changed-paths-combined` for further edge cases
(e.g. an octopus merge with 3+ parents; a merge where `git diff-tree -c`
itself fails/times out on a very large tree; the property test's own
non-vacuity self-check currently only proves it catches a fully-bypassed
gate, not specifically the bounce-#2 content-bearing-merge mutant) — that
this ticket's track record says is worth running before this reaches `main`.

## Everything else checked — no other defects

Full inventory run before this bounce, all PASS (see also the earlier
BL-630 architect bounce evidence files, both already fixed and re-verified
here):
- `npm run compile` (extension/): clean.
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb`: ALL TESTS PASSED.
- `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb`: 500 runs,
  ALL PROPERTIES HOLD, including the fixed content-bearing-merge oracle.
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh`: ALL PASS,
  including the real `git merge --no-ff` + hand-resolved-conflict fixture
  bounce #2 asked for — confirms both architect-found bugs are genuinely
  fixed.
- Acceptance (`BL-630-push-sweep-refuses-non-qa-approved-main.feature`): 5/5
  pass.
- Wiring: `push-sweep-qa-gate-facts!` is called from `push-sweep!`
  (`handoffd.bb:1966`), which is called from the real daemon tick
  (`handoffd.bb:2457`) — not merely unit-tested in isolation.
- Documenter pass: genuine (`b8433cc1a`, updates Specification.MD, the
  architecture diagram, and handoff-protocol.md, covering both the gate and
  the bounce-#2 correction).
- Full `npx vitest run` (unrelated TypeScript suite) is independently flaky
  under this sandbox's load — three consecutive full runs returned 19, 108,
  and 78 failures respectively, all concentrated in tests that shell real
  `git commit` fixtures (bridgeServer, epicMakeTopBridge, topicMakeTopBridge,
  tmpDirMigrationGuard, telegramCursorBridgeCli); every one of those files
  passes 100% clean when re-run in isolation. Not attributable to BL-630
  (touches no TypeScript under `extension/src/`) or to this bounce; flagged
  to the coordinator separately as its own environmental finding, not
  bounced here.

## Complete-inventory note

No other defects found. No `spec-gap` items. No blocked checks. Sent back to
hardener alone (single blamed role, the missing stage itself); nothing to
route to specifier or coordinator for this ticket's own defect.
