# BL-1414 — hardener pass, 2026-09-05

Ticket: BL-1414-a-repeating-freshness-violation-is-announced-once-then-digested
Commit reviewed: 4a09280ef0 (cleaner) / 6907118f57 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (2/2 killed)

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bash swarmforge/scripts/test/test_daemon_log_freshness.sh` | new BL-1414-01..05b: 13/13 ok; suite reports 4 pre-existing failures (BL-796-01/02/03, fleet-telegram curl mock) — independently confirmed genuinely pre-existing by checking out the PRE-BL-1414 commit's own test+checker files and re-running: identical 4 failures reproduce byte-for-byte |
| `bash swarmforge/scripts/test/bl1414_freshness_announce_digest_property_runner.sh` | ALL PROPERTIES HOLD, 200 runs each of P1/P2 |
| `node specs/pipeline/cli.js specs/features/BL-1414-...feature` | 6/6 scenario runs |
| `bb swarmforge/scripts/test/daemon_log_freshness_pulse_lib_test_runner.bb` (regression) | ALL PASS |
| `bash swarmforge/scripts/test/test_stop_swarm_freshness_cron.sh` (regression) | ALL CHECKS PASSED |
| `bash swarmforge/scripts/test/test_start_ancillary_services_freshness_cron.sh` (regression) | ALL CHECKS PASSED |
| `grep -n announce_transition_only daemon_log_freshness_check.sh` | 3 call sites (fresh/escalate/restart) inside `process_daemon` (required_wiring) |
| `bl1414FreshnessAnnounceDigestSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 2 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1414-a-repeating-freshness-violation-is-announced-once-then-digested.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **2 mutants, 2
killed, 0 survived** (the `<what>` example cells, single-letter case
flips) — clean. Manifest stamp committed alongside this evidence.

## Manual trace of `freshness_announce_lib.sh`'s state machine

- **Digest boundary is `>=`, not `>`**: `_at_elapsed -ge _at_digest_secs`
  fires the digest exactly at the window boundary, matching "when the
  window elapses" without an off-by-one gap where a tick landing exactly
  on the boundary second would wait one more tick.
- **Clock-skew safety**: a `now` earlier than the recorded
  `announced_epoch` (a negative `_at_elapsed`) falls through to the
  suppress branch rather than crashing or mis-firing a digest — `-ge` on a
  negative number against a positive `digest_secs` is simply false.
- **`restart` and `escalate` share one code path** by design: the state
  machine only distinguishes "in violation" from "fresh," never which
  specific action triggered the tick — matching invariant 2's own framing
  ("the first tick of any transition, into violation or back to fresh").
  Confirmed this is deliberate, not a missed distinction, by reading the
  `if [ "$_at_action" = "fresh" ]` guard: everything else is one branch.
- **Field-extraction sed pattern has no collision risk**: `_freshness_announce_field`
  is only ever called with the three fixed field names
  (`announced_epoch`, `suppressed`, `violation_started_epoch`), none a
  substring of another, so the loose `.*name=...` pattern cannot cross-match.
- **The "15 vs 14 suppressed" qa_e2e wording note** (coder's own evidence,
  confirmed by architect and cleaner): the ticket's illustrative qa_e2e
  narrative says "naming 15 suppressed ticks" while the implementation
  reports 14 for the same fixture (the digest tick itself is the 15th tick
  overall, but only 14 were genuinely silent before it). Neither the
  feature's own Gherkin text nor either declared invariant hardcodes a
  specific count — this is a qa_e2e narrative-precision question, not a
  gap in the DECLARED invariants, and not something for hardening to
  re-litigate; noted here only so QA does not independently rediscover
  the same non-issue as a fresh bounce.

No gap found. The property tests' real-subprocess isolation (P2 spawns a
genuinely separate `env -i sh -c` process per decision) is a stronger
proof of invariant 3 (durable, not process-memory state) than a log-grep
across two invocations of the same process would have been.

## Design/CRAP/DRY

No production code changed by this pass. Shell scripts have no
mutation/CRAP/DRY tooling wired (BL-472 deferred, cleaner already recorded
this fallback and confirmed `jscpd` finds 0 clones); gated by the
unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
