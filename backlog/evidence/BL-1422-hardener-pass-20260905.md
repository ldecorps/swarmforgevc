# BL-1422 — hardener pass, 2026-09-05

Ticket: BL-1422-work-note-not-completed-without-work
Commit reviewed: 099ad0e732 (cleaner) / 948306e3bf (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (4/4 killed); one
   reviewed-and-accepted git-timestamp-resolution limitation recorded below

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bash swarmforge/scripts/test/test_done_with_current_work_note_evidence.sh` | 9/9 |
| `bash swarmforge/scripts/test/test_done_with_current_arg_rejection.sh` (regression + new) | 8/8 |
| `bash swarmforge/scripts/test/test_dispatch_lib_receive_mode.sh` (regression) | 5/5, unaffected |
| `bb swarmforge/scripts/test/bl1422_work_note_not_completed_without_work_property_runner.bb` | ALL PROPERTIES HOLD, 500/500 each of P1/P2 |
| `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` (regression) | ALL TESTS PASSED, unaffected |
| `node specs/pipeline/cli.js specs/features/BL-1422-...feature` | 7/7 scenario runs |
| `grep -n dispatch-trail-ticket-id swarmforge/scripts/done_with_current_task.bb` | matches (required_wiring #1, via the cleaner's doc-comment fix) |
| `bl1422WorkNoteNotCompletedWithoutWorkSteps.js::registerSteps` present | yes (required_wiring #2) |

No orphaned processes and no leaked fixture roots after any run (checked
via `pgrep` and a fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (two Scenario Outlines present)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1422-a-work-note-is-not-completed-without-work.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **4 mutants, 4
killed, 0 survived** (both Outlines' example cells, single-letter case
flips) — clean, no equivalence analysis needed. Manifest stamp committed
alongside this evidence.

## Reviewed and accepted: git commit-timestamp resolution vs. the
   `--since` evidence check (not a defect — a fundamental git limitation)

While reading `git-log-names-ticket-since?` (`done_with_current_task.bb`),
confirmed empirically that `git log --since=<ISO instant with fractional
seconds>` truncates to whole-second granularity: a commit made in the
SAME wall-clock second as `dequeued_at`, even strictly BEFORE it, is
still matched by `--since`. Verified live:

```
# commit made at t; since = t + 0.999999s (same integer second)
$ git log --since="$SINCE" --format=%s HEAD
before dequeue, same second   <- wrongly matched
```

This looks at first like the same class of boundary gap as BL-1407's
shared-ceiling skip branch — but on closer inspection it is not a coding
bug reachable by a better comparison: **git commit dates themselves have
no sub-second resolution** (author/committer date is a whole-second Unix
timestamp in the object model). Re-reading the matched commit's own
timestamp via `%cI` and comparing with `java.time.Instant/isAfter` (the
same precise comparison `instant-after?` already uses for the sent/outbox
path) would not close this gap — the commit's OWN recorded instant is
already floored to the second, so a precise instant comparison against a
sub-second `dequeued_at` merely relocates the imprecision, and would
newly reject genuinely-fast legitimate commits made in the same second as
dequeue (a new false-negative, worse for the ticket's own goal than the
current narrow false-positive window).

The coder's own test fixture already demonstrates full awareness of this:
"a fixed `dequeued_at` let scenario 02a's own commit satisfy scenario 05's
later, unrelated Work note... fixed by capturing a fresh `dequeued_at`
immediately before each scenario (with a 1s sleep guaranteeing separation
at git's own commit-time resolution)" — i.e., the 1s sleep exists
specifically to route around this exact, unfixable-at-the-git-layer
constraint in their OWN fixtures, not something left unaddressed in the
production code.

Practical exposure: the false-positive window requires a PRE-EXISTING
commit whose subject exactly names the ticket id (via
`pipeline-stage-lib/extract-ticket-id`, not a substring) to land in the
identical wall-clock second as the dequeue event that later checks it —
a coincidence, not something a role can deliberately engineer without
already controlling commit timing to sub-second precision, which the
mailbox/dispatch machinery does not expose. Not a hardening gap to test
or a defect to bounce; recorded here so a future reader does not
re-discover and mis-diagnose the same one-second window as a fixable bug.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above plus the now-clean
BL-113 gherkin-mutation pass this ticket's two Outlines made possible.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
