Feature: BL-1256 the reconcile kill switch's stay-loud gate observes the daemon, not the library

  BL-1248's firm constraint is that switching the master-main-reconcile sweep
  off must decline to ACT on divergence without going QUIET about it: the
  drift log, the dirty-blocked surfacing and the operator escalation keep
  running while the switch is off. Its scenario 05 exists to fail if the
  guard is placed at handoffd's call site instead of at the
  :should-reconcile branch inside master-main-reconcile-lib/sweep!, because
  :surface! and :escalate! are injected INTO sweep! and fire from inside it.

  That scenario cannot fail for the reason it exists. Its handler
  (runDivergenceStillSurfaced) calls the library's 4-arg sweep! directly
  with a hand-passed disabled flag over fake adapters, and never reaches
  handoffd.bb, so it observes the decision layer rather than the wiring. It
  stays green for every guard placement in the daemon - including the one it
  was written to catch. Demonstrated 2026-08-29 against a real proposed
  change (hardener b617a292e6, not merged): that commit moves the guard to
  the call site and leaves the off path with no surfacing and no escalation
  at all, and BL-1248's acceptance would not have noticed.

  The gate must run against a real daemon tick. The infrastructure already
  exists and is already driven by scenarios 02 and 03 of the same handler
  file: swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh,
  a real git repo with a real bare origin and a real handoffd process. Prior
  art for firing exactly one reconcile tick deterministically, without a
  background process or a wall-clock wait: b617a292e6's --reconcile-sweep-once
  one-shot flag, which is the only reusable idea in that otherwise retired
  commit.

  # IR-DRY: the checker flags "runs one real reconcile tick" (01) against
  # "runs those real reconcile ticks" (02) as a possible synonym, score 0.64.
  # Reviewed and deliberately NOT normalized: one tick and N-ticks-past-the-
  # threshold are different behaviours - 02's escalation cannot be observed
  # from a single tick, so collapsing the wording would collapse the
  # distinction the scenario exists to test. The shared `Given the shipped
  # config sets ... to "false"` in 01 and 02 is likewise NOT lifted into
  # Background: scenario 03 inspects step handlers and never runs a daemon,
  # so a config Given does not hold for it.
  Background:
    Given a fixture repo with a real bare origin, whose local main and origin have diverged with local changes blocking a merge

  # BL-1256 kill-switch-gate-drives-the-daemon-01
  # The replacement for BL-1248 scenario 05's blind handler. What makes it a
  # gate rather than a restatement is the When: a REAL daemon tick, so where
  # the guard sits in handoffd.bb is observable.
  Scenario: with the switch off, a real daemon tick still surfaces the divergence it declined to reconcile
    Given the shipped config sets "master_main_reconcile_enabled" to "false"
    When the handoff daemon runs one real reconcile tick against the fixture
    Then the drift between local main and origin is recorded in the daemon log
    And the divergence is surfaced to a human by that same tick
    And no commit reachable from local main before the tick has been discarded

  # BL-1256 kill-switch-gate-drives-the-daemon-02
  # The escalation channel is a SECOND observable the call-site guard would
  # silence, distinct from the surfaced note in 01 - it reaches the operator
  # by alert rather than by coordinator note, so a green on 01 is not a green
  # on this.
  Scenario: with the switch off, a block that persists past the threshold still escalates to the operator
    Given the shipped config sets "master_main_reconcile_enabled" to "false"
    And the block has persisted for more reconcile ticks than the escalation threshold allows
    When the handoff daemon runs those real reconcile ticks against the fixture
    Then the operator escalation for the persistent block is still raised

  # BL-1256 kill-switch-gate-drives-the-daemon-03
  # Anti-regression on the gate itself: the shortcut this ticket removes is
  # cheap to reintroduce and invisible when it is. Trap-resistance - assert
  # on the INVOCATION shape (a bb -e script passing a literal disabled flag
  # into sweep!), never on the bare symbol name, or the prose in this file
  # and in the handler's own header trips it.
  Scenario: no off-path assertion is obtained from the library in isolation
    Given the step handlers for the reconcile kill switch's off-path scenarios
    When their invocations of the reconcile library are inspected
    Then none of them drives sweep! with a hand-passed disabled flag instead of the daemon
