# BL-902 — QA PASS: briefing-email decides sendability before composing

**Parcel verified:** documenter's commit `6db3af519e`
(`BL-902: documenter pass - no doc changes needed (NONE)`), merged into this
branch as `1d19f7ff2`.

## Lineage

Every prior stage's own commit for this ticket confirmed an ancestor of the
verified commit (`git merge-base --is-ancestor <commit> HEAD`):
- coder `5f0f43f12` (decide sendability before composing) and `340576b20`
  (acceptance-pointer flip)
- cleaner `1f457fad0` (skip-reason/log-key dedupe)
- architect `c80a0b054` (clean review, no defects)
- hardener `7c5b6ceda` (Gherkin-mutation manifest, both mutants killed)
- documenter `6db3af519e` (NONE — internal timing fix, byte-identical
  external behavior, no doc surface stale)

All confirmed ancestors of the verified commit, not merely of `HEAD` on a
busy branch.

## Prior bounce history

Read from `main` ref (`git log --oneline main -- 'backlog/evidence/BL-902*'`):
no prior bounce for this ticket — only the architect and documenter clean-pass
(NONE) evidence files. Nothing to re-verify as fixed.

## Independent verification run this pass

- **Babashka unit/property suites**: `bl902_briefing_send_reason_property_runner.bb`
  (300/300 seeded runs, ALL PASS, non-vacuity proven at authoring time via a
  documented break-then-fix), `briefing_email_test_runner.bb` (ALL PASS),
  `test_daemon_alarm_lib.sh` (ALL PASS, including the BL-902-specific
  `email-send-reason`/`configured-email-send-reason` cases), `test_handoffd_briefing_email_wiring.sh`
  (ALL PASS, including the multi-cycle early-skip and one-shot-warning cases).
- **Acceptance pipeline** (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-902-briefing-email-composes-before-key-check.feature`):
  7/7 scenarios pass, covering the ticket's own qa_e2e_procedure: missing-key
  skip with zero section adapters invoked, both undeliverable-reason
  Examples rows, retry-on-next-sweep, one-shot warning across 3 sweeps, full
  compose+send-once on the happy path, and cost independent of backlog size
  (diagram/backlog-heavy fixture).
- **Extension unit suite** (`npm run test`): 7733/7733 tests, 437/437 files
  passed, exit code 0.
- **Property command** (`npm run test:properties`): 304/304 tests, 97/97
  files passed, exit code 0. Three benign `[vitest-worker]: Timeout calling
  "onTaskUpdate"` RPC warnings logged (host load from the suite's own nested
  vitest-subprocess tests, e.g. `vitestWorkerMemoryBudget.test.js`) — zero
  test failures, exit code 0. Confirmed unrelated to BL-902: none of its
  commits touch `extension/src`, `extension/test`, or vitest infrastructure
  (checked per-commit via `git show --stat`; BL-902's full diff is confined
  to `swarmforge/scripts/{briefing_email_lib,daemon_alarm_lib,handoffd}.bb`,
  `specs/pipeline/steps/{bl902BriefingSendabilityGateSteps.js,index.js}`,
  and the ticket's own `specs/features/*.feature` + `backlog/evidence/*`).
- **Orphan check**: `pgrep -fl 'node --test|stryker|vitest'` returned nothing
  before this pass and returned nothing after it completed.

## Wiring — real caller, not just isolated tests

`handoffd.bb`'s `briefing-send-reason!` (line ~2027) calls
`daemon-alarm-lib/configured-email-send-reason` (pure predicate, conf+env
only) and fires the existing one-shot `email-misconfigured` warning via the
same `briefing-missing-key-warned?` atom used before this ticket.
`briefing-email-sweep!` (line ~2238, the daemon's real per-tick call site)
passes it as the `:send-reason!` key into `briefing-email-lib/send-unsent-briefings!`,
which consults it before any of the eleven optional section adapters,
`:diagram-section`, or `:read-briefing-content` is invoked — confirmed
directly in `briefing_email_lib.bb`'s `send-unsent-briefings!` body (the
`early-reason` check runs before `compose-and-send-one!` is ever called).
This is the live daemon path, not merely a unit-tested-in-isolation function.

## Invariants — non-vacuous coverage confirmed

All three of the ticket's declared invariants (zero-adapter-invocation,
cost-independent-of-backlog-size, byte-identical-outcome) have property-test
coverage in `bl902_briefing_send_reason_property_runner.bb`. The runner's own
header documents non-vacuity was proven by hand: temporarily reverting
`send-unsent-briefings!` to the pre-BL-902 always-compose shape made P1/P2
fail on every generated case before the fix was restored — a real property,
not a tautology.

## Scope

Every stage's own commit (checked individually via `git show --stat`) touches
only files inside this ticket's declared scope
(`swarmforge/scripts/briefing_email_lib.bb`, `daemon_alarm_lib.bb`,
`handoffd.bb`, the ticket's own feature file, step handlers, and evidence).
No out-of-scope functional file appeared in any stage's diff.

## Verdict

APPROVE. All gates pass. Landing on `main`, broadcasting merge-up, notifying
coordinator for bookkeeping.

By QA.
