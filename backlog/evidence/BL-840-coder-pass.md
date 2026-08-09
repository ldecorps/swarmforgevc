# BL-840 — coder pass

Wires BL-650's provider-outage subtraction into production: a producer
(`provider_outage_evidence_lib.bb`, new lib) rides the daemon's existing
20-line pane capture (`observe-standing-role-auth!`) to record
`:unavailable`-classified pane text, throttled; `flow-watchdog-sweep!`
supplies `:provider-outage-evidence-for`, reading that store back keyed by
each role's configured provider. Also fixes the classifier gap the ticket's
own probe found (529/`overloaded_error` classified `:unknown`).

## Classifier fix (both languages, kept in parity)

`agent_runtime_lib.bb`/`providerErrorTaxonomy.ts`'s `:unavailable` pattern:
added `529`, and changed `overloaded` to `overloaded\w*` so the pattern's
shared trailing `\b` can match after `overloaded_error` (`_` is a word
character, so `d`→`_` was never a boundary — the exact motivating incident
text never classified as unavailable before this fix). Verified directly
against both classifiers and via `run_acceptance.sh` on BL-207's own
feature (3/3, unmodified, regression-clean).

## `provider_outage_evidence_lib.bb` (new)

Mirrors `availability_ledger_lib.bb` (BL-823)'s monthly-JSONL-file shape,
but is both the sole writer (`record-provider-outage!`) and sole reader
(`evidence-for-provider`) — there is no separate TS/sh writer twin, since
the only producer is the daemon's own pane observation, already Babashka.

- `record-provider-outage!`: throttled append, at most one line per
  **observing role** per `provider_outage_observe_min_interval_ms` (default
  60000, new `swarmforge.conf` knob, `parse-observe-min-interval-ms`
  mirrors `mono_router_lib.bb`'s `parse-note-actionable-after-ms` exactly —
  absent/malformed/zero/negative degrade to the default). Throttle key is
  the *observing role*, not the provider — two roles on the same provider
  each get their own budget, since they're independent observation
  streams; their evidence merges by provider only on the read side.
- `evidence-for-provider`: filters the durable store by `:provider`, never
  by which role/pane a line was observed on (invariant 3). Fail-closed
  throughout (`read-records`, `last-recorded-ms-for-role`): a missing
  telemetry dir, unreadable file, or corrupt line degrades to skipping,
  never throwing — mirrors `availability_ledger_lib.bb/read-records`
  exactly, verified directly (missing dir → `[]`; corrupt file → `[]`, and
  a `record-provider-outage!` call against that same corrupt-neighbor
  store still succeeds).

## Wiring (`handoffd.bb`)

- `observe-pane-provider-outage!` (new): classifies the SAME pane snapshot
  `observe-pane-auth!` already captured (no second tmux capture, per the
  ticket's constraint) via `agent-runtime-lib/classify-provider-error`; on
  `:unavailable`, calls `record-provider-outage!` with the role's
  configured provider (`:agent role-info`) and the live clock. Called from
  inside `observe-standing-role-auth!`'s existing loop, which is invoked
  every chase sweep (line 1533, inside the daemon's real polling tick,
  wrapped in the same try/catch as the auth observer) — `required_wiring`'s
  second line confirmed live, not merely a defined function.
- `flow-watchdog-provider-outage-evidence-for` (new) + `flow-watchdog-sweep!`
  now supplies `:provider-outage-evidence-for`, resolving role → provider
  via `(:agent (get roles role))` (the same BL-208 lookup `:log-telemetry!`
  beside it already uses) and reading that provider's evidence —
  `required_wiring`'s first line confirmed live (verified by grepping the
  landed diff for the adapter key inside the real production caller, not
  just its existence in `flow_watchdog_lib.bb`'s own doc comment).

`handoffd.bb` cannot be `load-file`d directly for a syntax check — it calls
`(-main)` unconditionally at file scope, which would start a real daemon
(bound sockets, pidfile, infinite poll loop). Verified instead via a
scratch copy with the trailing `(-main)` line stripped
(`sed '$d'`), loaded against a throwaway temp project-root with
`SWARMFORGE_ALLOW_TMP_DAEMON=1` (BL-406's own sanctioned test-fixture
escape hatch) — exit 0, no errors, scratch file removed immediately after.

## Config

`swarmforge.conf`: documented `provider_outage_observe_min_interval_ms`
(commented default line, matching every other knob's convention — the
literal itself lives only in
`provider-outage-evidence-lib/default-observe-min-interval-ms`).

## Acceptance

`specs/features/BL-840-provider-outage-evidence-reaches-flow-watchdog.feature`
already existed (not a draft); wrote its step handlers
(`bl840ProviderOutageEvidenceReachesFlowWatchdogSteps.js`) against a new
JSON-bridge runner (`bl840_provider_outage_evidence_acceptance_runner.bb`,
same pattern as BL-849/BL-486/BL-458), driving the REAL producer, reader,
and `flow_watchdog_lib.bb/run-sweep!` — never a hand-fabricated evidence
vector for scenarios 04/05. `run_acceptance.sh`: 16/16 subtests pass.

One fixture bug caught and fixed mid-build: scenario 04's "holds an
outage from T1 to T2" fixture initially seeded only the two endpoint
timestamps 30 minutes apart — `provider-outage-intervals`' 10-minute
gap-grouping window (`flow_watchdog_lib.bb`) correctly refused to merge
them into one interval, so the expected 30-minute subtraction silently
came out as zero. Fixed by seeding observation points every 5 minutes
across the span, matching what a real throttled observer actually
produces for a standing banner.

## Non-vacuity (BL-654)

Three declared invariants, each a coder-authored property test
(`extension/test/bl840ProviderOutageEvidenceInvariants.property.test.js`),
all driving the real Babashka functions via the acceptance runner (never
reimplementing throttle/attribution/subtraction logic in JS):

- **Invariant 1** (fail-closed): missing/empty/corrupt evidence × randomized
  wall age/role/provider — effective age always equals wall age, sweep
  always completes without error.
- **Invariant 2** (throttle bound): randomized observation sequences
  (strictly-increasing offsets built from random gap multiples of the
  interval, crossing exact-boundary cases deliberately) — recorded line
  count matches an independently-computed greedy expectation.
- **Invariant 3** (attribution by provider): 0-4 other roles, each randomly
  sharing or not sharing the observed provider — subtraction applies
  exactly to shared-provider roles, never to others.

All three verified non-vacuous: sabotaged (invariant 2: dropped the
throttle check entirely; invariant 3: filtered by `:role` instead of
`:provider`), reran, both failed with the expected shape, restored, unit
tests reconfirmed green.

## Commands run

```
bb swarmforge/scripts/test/classify_provider_error_harness.bb '<text>'
bb swarmforge/scripts/test/provider_outage_evidence_lib_test_runner.bb
bb swarmforge/scripts/test/flow_watchdog_test_runner.bb                 # regression
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-840-provider-outage-evidence-reaches-flow-watchdog.feature
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-650-*.feature                          # regression
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-207-normalized-provider-error-taxonomy.feature  # regression
npx tsc --noEmit -p extension                                            # regression
npx vitest run --config extension/vitest.properties.config.mjs bl840ProviderOutageEvidenceInvariants
```

All green. By coder.
