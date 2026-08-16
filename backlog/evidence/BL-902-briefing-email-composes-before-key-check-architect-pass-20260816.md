# BL-902 — architect pass — 2026-08-16

## Scope reviewed

Parcel received from cleaner via `merge_and_process cleaner 1f457fad04`.
First pass through architect (no prior `bounce_history` on the ticket).
Three commits in scope:

- `5f0f43f12` (coder) — decides briefing-email sendability before
  composing. `daemon_alarm_lib.bb` gains `email-send-reason` (pure
  predicate, factored out of `send-alarm-email!`'s own cond) and
  `configured-email-send-reason` (conf+env resolution only, no compose/
  send). `briefing_email_lib.bb`'s `send-unsent-briefings!` consults an
  optional `:send-reason!` adapter first, skipping straight to the same
  `briefing-skip-*` log line when undeliverable; the expensive gather+
  render+send logic is extracted unchanged into `compose-and-send-one!`
  so the skip path never reaches it. `handoffd.bb` wires
  `briefing-send-reason!`, preserving the one-shot missing-key warning via
  the existing `briefing-missing-key-warned?` atom. Adds a property-test
  runner encoding all three declared invariants, an example-based lib test
  runner, two shell wiring tests, and acceptance step handlers.
- `340576b20` (coder) — flips the ticket's `acceptance:` pointer to the
  promoted `.feature` file (single-line pointer, per BL-514/BL-624
  convention).
- `1f457fad0` (cleaner) — dedupes the skip-reason→log-key mapping between
  the early-skip path and the post-compose result path (both now call the
  same `skip-log-key`), no behavior change.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` is a dependency-cruiser
front end scoped to `extension/src/**` (see `extension/.dependency-cruiser.cjs`'s
`from: {path: '^src/'}` rules) — it cannot open non-JS/TS files and errors
on any `.bb` path. This ticket touches zero `extension/src` files (pure
Babashka: `briefing_email_lib.bb`, `daemon_alarm_lib.bb`, `handoffd.bb`,
plus `specs/pipeline/steps/*.js` acceptance glue). The gate does not apply
to this parcel — confirmed by attempting to run it against the changed
`.bb` files and observing the tool's own "can't open" error, not a
silent skip.

## Co-change coupling (informational, BL-255)

`node extension/out/tools/co-change-report.js` against the three changed
`.bb` files reports `briefing_email_lib.bb` most strongly coupled with
`handoffd.bb` (18 co-changes) and `specs/pipeline/steps/index.js` /
`briefing_email_test_runner.bb` (19 each) — expected: `handoffd.bb` is the
sole production wiring point for `briefing_email_lib.bb`'s adapters, and
the test/step files co-change with the lib by construction of this
feature. `daemon_alarm_lib.bb` shows only 3 co-changes with
`briefing_email_lib.bb`, below the tool's coupling-flag pattern for
concern. No hidden/surprising coupling.

## Two-layer boundary / architecture rules

Not applicable in the usual sense — this parcel is entirely `handoffd`
daemon code (Babashka), never the extension host or webview. No tile/tmux
boundary, no `postMessage` surface, no browser storage, no secrets written
to a target repo. `RESEND_API_KEY` is still read from `System/getenv`
only, never persisted. Scope stayed inside the ticket's stated boundary
(`briefing_email_lib.bb` + `daemon_alarm_lib.bb`'s new predicate) — the
watchdog and `daemon_freshness_threshold` were correctly left untouched,
matching the ticket's explicit "do not raise the threshold" instruction.

## Invariants review (BL-633/BL-654)

All three declared invariants have a non-vacuous property test in
`swarmforge/scripts/test/bl902_briefing_send_reason_property_runner.bb`
(seeded-LCG, 300 runs each), with the runner's own header documenting the
break-then-fix proof performed at authoring time (reverted the early-skip
call, confirmed P1/P2 fail with the "must never be called" sentinel
thrown, restored the fix, reran green). I reran the property runner myself
rather than trusting the commit message:

- P1/P2 zero-gathering-cost-independent (content-len up to 5000, diagram-
  count up to 20, varied per run) — 300/300 pass.
- P3 byte-identical-outcome (early-skip path vs. the pre-BL-902
  compose-then-fail path produce the same `sent` set and the same `log!`
  calls) — 300/300 pass.
- Generator-reach floor confirms both `:disabled` and `:missing-api-key`
  are actually sampled within the run budget.

Cross-checked the property's 13-adapter tracked set (`:read-briefing-
content` + 11 optional sections + `:diagram-section`) against
`handoffd.bb`'s real `briefing-email-sweep!` wiring — identical key set,
no drift between the harness/property fixture and production wiring.

## Property-testing pass beyond declared invariants (BL-654 scope)

No further pure module was touched that warrants a new property test.
`email-send-reason`'s domain is two booleans (blank?/non-blank? × blank?/
non-blank?) — fully enumerable by the four example-based cases already in
`test_daemon_alarm_lib.sh` ("BL-902: email-send-reason computes ... exactly
as send-alarm-email!'s own cond always did" and the byte-identical-result-
shape test); a property test would add no coverage a property-quantified
range wouldn't already get from exhaustive enumeration.

## Correctness read

Compared `compose-and-send-one!` against the pre-BL-902 inline body it was
extracted from — identical logic, no reordering, no dropped branch.
Compared `email-send-reason`'s branch order (blank `to` → `:disabled`,
then blank `api-key` → `:missing-api-key`, else `nil`) against the cond it
replaced in `send-alarm-email!` — same order, same result shape via
`case`. Confirmed `configured-email-send-reason`'s to/api-key resolution
(`(get conf "notify_email_to")` / `(System/getenv "RESEND_API_KEY")`)
matches `send-configured-email!`'s own resolution byte-for-byte; the
omitted `project-root` argument only gates the real network POST
(`test-fixture-root?` → `suppressed-post!`), never the `:disabled`/
`:missing-api-key`/`nil` verdict, so its absence from the early-skip
predicate is correct, not a gap. No architecture or correctness defect
found.

## Tests reran myself

- `bb swarmforge/scripts/test/bl902_briefing_send_reason_property_runner.bb`
  — ALL PASS (300 runs).
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_daemon_alarm_lib.sh` — ALL PASS (28
  cases incl. 5 new BL-902 cases).
- `bash swarmforge/scripts/test/test_handoffd_briefing_email_wiring.sh` —
  ALL PASS (incl. 2 new BL-902 cases).
- `node specs/pipeline/cli.js specs/features/BL-902-briefing-email-composes-before-key-check.feature`
  — 7/7 acceptance scenarios pass.

## Verdict

NONE — no architecture violation, no invariant violation, no correctness
defect. Forwarding to hardener.
