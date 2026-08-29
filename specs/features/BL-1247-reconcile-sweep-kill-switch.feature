Feature: the master-main reconcile sweep can be switched off, and off means it writes nothing
  handoffd runs a master-main reconcile sweep every tick. Its conflict
  prediction is broken in a way BL-1236 has pinned to one line, and on
  2026-08-27 and 2026-08-28 that sweep reset local main onto origin/main
  thirteen times, each time making committed work unreachable - including a
  human ruling in transit and a ticket's own close commit. BL-1236 fixes the
  prediction but is not built yet.

  The human ruled, 2026-08-28: "Disable the master-main-reconcile sweep until
  BL-1236 lands". This feature is that switch. It is deliberately a refusal to
  act rather than a different action: while the sweep is off, nothing in the
  daemon may reset, rematch, merge or otherwise rewrite main, and a divergence
  simply waits for a human or for BL-1236.

  The switch fails closed. A setting that is absent, empty or unreadable
  leaves the sweep off, because the sweep's whole defect is that it destroyed
  committed work on an answer it should not have trusted - an unavailable
  answer must never authorise a destructive write.

  Background:
    Given local main has diverged two ways from origin/main
    And the divergence carries local commits that origin does not have

  # BL-1247 reconcile-sweep-kill-switch-01
  Scenario Outline: The switch decides whether the sweep runs at all
    Given the reconcile switch is <setting>
    When the reconcile sweep tick fires
    Then the sweep <outcome>

    Examples:
      | setting    | outcome      |
      | on         | runs         |
      | off        | does not run |
      | absent     | does not run |
      | unreadable | does not run |

  # BL-1247 reconcile-sweep-kill-switch-02
  Scenario: Off means main is left exactly as it was found
    Given the reconcile switch is off
    When the reconcile sweep tick fires
    Then local main points at the same commit it pointed at before the tick
    And every local commit that preceded the tick is still reachable from HEAD

  # BL-1247 reconcile-sweep-kill-switch-03
  Scenario: A skipped sweep still says what it saw
    Given the reconcile switch is off
    When the reconcile sweep tick fires
    Then the daemon records that the sweep was skipped because the switch is off
    And the record names the divergence the sweep declined to act on

  # BL-1247 reconcile-sweep-kill-switch-04
  Scenario: Switching off takes effect without restarting the daemon
    Given the reconcile switch is on
    When the switch is turned off with the daemon left running
    And the reconcile sweep tick fires
    Then the sweep does not run
