Feature: A given-up child stays down for its whole cooldown

  Six supervisors share one bounded-restart decision function. Each declares a
  15-minute give-up cooldown: once a child exhausts its attempt budget the
  supervisor stops spawning it, so a child that cannot start produces one
  bounded outage instead of an endless restart loop.

  The re-arm test reads "cooldown elapsed OR the recorded process is dead". A
  child that gave up BECAUSE it crash-looped is always dead, so the second
  clause is true on the very next tick and the declared cooldown never applies
  to the case it was written for. The budget resets to zero and the child is
  respawned every tick - a 2-second hot loop in place of a 15-minute wait.

  A supervisor that genuinely needs to recover faster lowers its OWN cooldown:
  all six already read one from their own environment variable. That is the
  sanctioned way to shorten the outage, and it keeps the bound honest for
  every other supervisor. Bypassing the cooldown removes the bound entirely.

  Background:
    Given a supervisor whose child has exhausted its restart budget and reached give-up

  # BL-1088 a-given-up-child-stays-down-for-its-whole-cooldown-01
  Scenario Outline: a given-up child is not respawned before its cooldown elapses
    Given the give-up cooldown has not yet elapsed
    And the given-up child's recorded process is <process state>
    When the supervisor checks the child
    Then the child is still given up
    And no replacement is spawned

    Examples:
      | process state |
      | dead          |
      | still alive   |

  # BL-1088 a-given-up-child-stays-down-for-its-whole-cooldown-02
  Scenario: a given-up child re-arms once its cooldown has elapsed
    Given the give-up cooldown has elapsed
    When the supervisor checks the child
    Then the child is respawned with a fresh restart budget
    And any process still recorded against the given-up child is terminated before the replacement spawns

  # BL-1088 a-given-up-child-stays-down-for-its-whole-cooldown-03
  Scenario: the restart budget bounds spawns across a whole cooldown window
    Given a child that fails every time it is started
    When the supervisor ticks repeatedly for the length of one cooldown window
    Then the child is started no more times than its configured attempt cap allows

  # BL-1088 a-given-up-child-stays-down-for-its-whole-cooldown-04
  Scenario: a supervisor shortens its own outage by lowering its configured cooldown
    Given the supervisor is configured with a shorter cooldown than the default
    When the supervisor checks the child after that shorter cooldown has elapsed
    Then the child is respawned with a fresh restart budget
