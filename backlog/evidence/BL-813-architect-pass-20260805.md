# BL-813 architect review — clean pass, NONE

**Ticket:** BL-813 — handoffd death email must attach the failure log (the
BL-812-close incident left an off-box operator holding only an on-disk
path), and ambulance's `ticket-has-file?` must not crash when a glob-listed
backlog yaml is moved/deleted before slurp (the actual root cause of that
crash).
**Reviewed commit:** 3236f454 (coder, merged into cleaner as 364e2619,
received via merge_and_process).
**Role:** architect.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** No file under `extension/src`
   or `extension/media` changed in this parcel's diff (only
   `swarmforge/scripts/{daemon_alarm_lib,handoffd_supervisor,ambulance_lib}.bb`,
   their test fixtures, one pipeline step-handler `.js` file, and
   specs/backlog files). Ran `dependency-gate.js` in full-repo mode from
   `extension/` anyway (not just per-file, since per-file mode errors on a
   non-`extension/src` path by design — confirmed, matching BL-812's prior
   finding): it reports one pre-existing acyclic-rule violation among
   `telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
   `telegramCursorOperatorLiveness.ts`. `git log` on those three files shows
   their last touch was BL-611, well before this parcel and untouched by it —
   confirmed pre-existing and out of this ticket's scope, not a regression
   this parcel introduced.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against all three touched `.bb` files. Top-ranked coupling in each case is
   the file's own paired test/harness (`test_daemon_alarm_lib.sh`,
   `ambulance_lib_test_runner.bb`, `test_handoffd_supervisor.sh`) and
   `specs/pipeline/steps/index.js` (the step-registry file every new feature
   edits once) — expected, intentional coupling. No coupling outside this
   subsystem's existing shape.

3. **Two-layer / IO-ownership / integrate-not-fork / webview-storage /
   secrets rules:** not implicated — this parcel touches only the
   maintained-fork swarm scripts (`swarmforge/scripts/*.bb`) and the
   acceptance pipeline, not the extension host, webview, or upstream
   SwarmForge source. No secret material is written to disk or committed
   (RESEND_API_KEY stays a `System/getenv` read, unchanged by this parcel).

4. **Required wiring (all 3 items in the ticket YAML), confirmed present and
   live-tested, not just capability-tested:**
   - `daemon_alarm_lib.bb::attachments` — `alarm-and-halt!` now builds a
     `{:filename :content-id :base64}` descriptor from the failure-log
     content it just wrote (`build-failure-attachment`, encoding the exact
     in-memory string, never re-slurping the file that can itself vanish)
     and threads it through the 3-arg `send-email!` adapter call. Proven by
     `bl813_daemon_alarm_lib_property_runner.bb` P1 (byte-for-byte fidelity,
     independent oracle) and `test_daemon_alarm_lib.sh`'s new
     `BL-813 attach-01` assertion (decodes the attachment and diffs it
     against the actual `failure.log` file on disk).
   - `handoffd_supervisor.bb::send-configured-alarm-email!` — now a 3-arg
     fn (`subject text attachments`) forwarding into
     `daemon-alarm-lib/send-configured-email!`'s 7-arg (attachment-capable)
     form. Grepped every caller of `send-configured-alarm-email!` in the
     tree: the only production call site is this file's own `alarm-and-halt!`
     wiring (line 391); no other site was left on the old 2-arg shape.
     Proven live (not just "the callee accepts attachments") by
     `bl813_supervisor_alarm_attachment_wiring_test.bb`, which loads the real
     supervisor, intercepts only `daemon-alarm-lib/send-configured-email!`,
     and asserts the attachments arg the supervisor's own adapter forwards
     matches unchanged — plus a regression assertion that the old 2-arg call
     shape now throws `ArityException` instead of silently dropping
     attachments.
   - `ambulance_lib.bb::ticket-has-file?` — each glob candidate's
     slurp+field-read is now its own `try/catch`, so a vanished entry is
     skipped (`some` moves to the next candidate or to `false`) instead of
     throwing. Proven by `bl813_ambulance_vanish_safety_property_runner.bb`
     P1 (never throws, degrades only for the specific vanished
     `(ticket, dir)` pairs, a surviving copy elsewhere still resolves true)
     and P2 (the same race through the real production reader
     `read-ambulance-state`, not just the raw predicate).

5. **Declared invariants (BL-654), reviewed as three distinct passes, all
   with non-vacuous property-test encodings (break-then-fix documented in
   each runner's own header comment, independently re-run by this role — see
   §7):**
   - Invariant 1 (death alarm always attaches the exact written failure-log
     content when email is configured): P1 in
     `bl813_daemon_alarm_lib_property_runner.bb`, plus
     `test_daemon_alarm_lib.sh`'s `BL-813 attach-01`.
   - Invariant 2 (`ticket-has-file?` never throws on a vanished glob entry;
     ambulance degrade-to-off remains the failure mode): P1/P2 in
     `bl813_ambulance_vanish_safety_property_runner.bb`, plus acceptance
     scenarios 02/03 driving the real `ambulance_lib.bb` via
     `bl813_acceptance_harness.bb` (never a reimplementation).
   - Invariant 3 (BL-144 no-auto-restart / alarm-and-halt posture unchanged):
     P2 (attachment-build failure still lets `halt-swarm!` run) and P3
     (`halt-swarm!` fires exactly once, final state is always `"halted"`
     regardless of prior state) in
     `bl813_daemon_alarm_lib_property_runner.bb`, plus the pre-existing
     `test_handoffd_supervisor.sh` regression assertions (`04: no silent
     auto-restart remains`) re-run clean in §7 below.

6. **Property-testing pass (undeclared properties on touched pure modules):**
   all three touched modules' property-shaped surface is already exhaustively
   covered by the coder's invariant-encoding property tests above (§5) — no
   additional pure/testable module was touched by this parcel that is
   undercovered. No new property test owed from this pass.

7. **Tests re-run independently by this role, all green:**
   `bl813_daemon_alarm_lib_property_runner.bb` (500/500, ALL PROPERTIES
   HOLD), `bl813_ambulance_vanish_safety_property_runner.bb` (500/500, ALL
   PROPERTIES HOLD), `bl813_supervisor_alarm_attachment_wiring_test.bb`
   (ALL PASS), `test_daemon_alarm_lib.sh` (ALL PASS, including the new
   `BL-813 attach-01` line), `test_ambulance_cli.sh` +
   `ambulance_lib_test_runner.bb` (ALL PASS — the harness's own
   `tmp_cleanup.sh` prints an unrelated post-completion "unbound variable"
   shell warning, confirmed pre-existing to BL-459 and untouched by this
   parcel), `test_handoffd_supervisor.sh` (ALL PASS, full regression suite
   including the no-auto-restart assertions). Acceptance: `specs/pipeline/
   cli.js` against `BL-813-handoffd-death-email-attach-and-ambulance-race.
   feature` — 3/3 scenarios pass, driving the real libraries via the step
   handlers (no reimplementation).

8. **Out-of-scope compliance:** no extension/webview code touched; the BL-812
   epic bookkeeping diff (`BL-539` `decomposes_into`, topic records) is
   routine specifier/coordinator ticket hygiene, not part of this parcel's
   functional change.

## Disposition

Architecturally compliant. Forwarding to hardender.
