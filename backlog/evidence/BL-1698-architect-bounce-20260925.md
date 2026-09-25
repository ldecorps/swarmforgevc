# BL-1698 — architect review pass, 2026-09-25 (post QA-bounce fix)

2 defect(s) found. One bounce, complete inventory (Article 4.4).

Reviewed commit: eefad0e138 (cleaner, forwarding coder's 38547625ae
"fix QA bounce D1-D7"). D1, D4, D5, D6, D7 verified fixed and each has a
regression test that genuinely fails when its fix is reverted (checked
empirically for D7; D4/D5 read directly). D2 and D3's own fixes ship with
no test that fails when the fix is reverted — the same "fix shipped,
nothing proves it" class QA already bounced D1 and D7 for in the prior
round.

## D1 (this pass)

- **Failing command**: empirical revert probe — removed the `(driver-seat?
  agent) {...:skip-driver-seat...}` cond clause added to
  `swarmforge/scripts/babysitter_nudge_lib.bb`'s `nudge-resident!` (QA
  bounce D2's fix), then ran `bash
  swarmforge/scripts/test/test_babysitter_nudge_driver_seat_skip.sh` and
  the BL-1698 acceptance feature's scenario 06.
- **Commit hash**: eefad0e138
- **First error excerpt**: both ALL PASS with the clause entirely deleted —
  `test_babysitter_nudge_driver_seat_skip.sh`'s only seat is `coder` on
  agent `aider`, whose `:wake-style` is `:shell-run-script`, so the
  pre-existing `aider-agent?` clause (earlier in the `cond`) already skips
  it and short-circuits before `driver-seat?` is ever reached; `aider` is
  currently the only `:parcel-driver true` provider
  (`prompt_engine_lib.bb`), so no fixture in the suite has a
  driver-capable seat with a NON-aider `:wake-style` to actually exercise
  the new clause.
- **Failure class**: unit
- **Expected vs observed**: QA's own D2 remediation — "a driver-capable
  seat with a `:chat-message` wake style would still be nudged" — implies
  the fix must be provably reachable / observed: the new branch is live,
  correctly ordered and logically sound, but zero test in the suite can
  tell it apart from not existing at all
- **Blamed role**: coder
- **Remediation pointer**: `swarmforge/scripts/test/test_babysitter_nudge_driver_seat_skip.sh`
  (or a new dedicated test): stub/fake a driver-capable, non-aider agent —
  e.g. redef `agent-runtime-lib/capabilities` (or add a throwaway entry to
  `prompt_engine_lib.bb`'s agent map for the fixture) to return
  `{:wake-style :chat-message :parcel-driver true}` — and assert
  `nudge-resident!` returns `:skip-driver-seat` with no tmux `send-keys`
  for that seat, so the assertion fails whenever the `driver-seat?` clause
  is missing regardless of `cond` ordering or which provider is aider
  today

## D2 (this pass)

- **Failing command**: empirical revert probe — removed both
  `(ensure-chat-set-up! ctx state)` call sites (QA bounce D3's fix) from
  `run-gate!` and `resume-from-hold!` in
  `swarmforge/scripts/local_parcel_driver_lib.bb`, then ran
  `extension/test/bl1698LocalParcelDriverMailAndReleaseEdgeCases.test.js`,
  the BL-1698 feature, and the BL-1697 feature.
- **Commit hash**: eefad0e138
- **First error excerpt**: all suites still pass (6/6, 9/9, 12/12) with
  both call sites deleted. The "D4" unit test's own comment claims it
  covers D3 ("redoes the chat set-up (D3)") but its only relevant
  assertion is `typedAfterAnswer > 0` — true before this ticket too, since
  `answer-fix-request-text` was always typed on resume; nothing in any
  suite asserts the `/clear`, `/read-only` or `/add` commands
  `chat-set-up!` sends (no test file matches `chat-clear|/add |/read-only`
  against this behaviour).
- **Failure class**: unit
- **Expected vs observed**: requirement 1 / D3's own remediation — "a
  relaunched seat's chat is set up again... before any fix request" — is a
  behaviour that must be provably present / observed: the call sites exist
  and are logically correct (verified by reading), but no test fails when
  they are removed, so a future edit silently regressing D3 (the exact
  defect QA bounced) would ship green
- **Blamed role**: coder
- **Remediation pointer**: `extension/test/bl1698LocalParcelDriverMailAndReleaseEdgeCases.test.js`'s
  D4 test (or a new one): assert the typed tmux `send-keys` sequence
  around the answer's fix request and around a failing-gate fix request
  contains the `/clear` (or the read-only/add markers `chat-clear!`/
  `chat-read-only!`/`chat-add!` actually type) — not merely that
  `typedAfterAnswer > 0` — so the assertion fails when `ensure-chat-set-up!`
  is removed

By architect.

## Detail

Everything else in the fix was verified clean:
- D1: scenario 06 rewired to drive `babysitter_nudge_lib.bb`'s own
  `nudge-resident!` via `test_babysitter_nudge_driver_seat_skip.sh` —
  confirmed it is the live consumer, not handoffd's wake path.
- D4: dedicated unit test ("D4: after the answer's one fix request...")
  asserts `fixTurnsUsed == fixTurnsLimit` and no second typed fix request —
  read directly, non-vacuous on its face (state assertion is specific).
- D5: dedicated unit test asserts the mail hold's state is left byte-equal,
  no typed calls, and the answer stays unconsumed — non-vacuous.
- D6: `resume!` deleted; `grep -n resume-writable-sweep`
  confirms `handoffd.bb:5559` is the only startup caller and matches the
  updated how-to/diagram.
- D7: empirically confirmed non-vacuous — reverting the
  `resume-writable-sweep!` call in `handoffd.bb`'s startup path makes
  `test_handoffd_startup_restores_driver_spec_writable.sh` fail.
- Dependency gate (`extension/out/tools/dependency-gate.js`) and co-change
  report (`extension/out/tools/co-change-report.js`) both clean/informational
  only, same run as the prior architect pass on this lineage
  (`BL-1698-architect-20260925.md`, 4cdf561d5d).
- Ticket's two declared invariants: invariant 1 (spec-writable restore) —
  D7's new test. Invariant 2 (every mail ends in handoff/completion/
  recorded hold) — the mechanical-mail! test and D5's guard.
- All reverted probe files restored byte-identical (`git diff --stat`
  empty) before this evidence was written.

Routing: both items are the coder's (the fix code, not the test, is what
shipped) — one bounce, inventory travels (Article 4.4).
