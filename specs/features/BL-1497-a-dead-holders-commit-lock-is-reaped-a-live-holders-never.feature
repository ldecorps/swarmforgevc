Feature: BL-1497 A commit-integrity lock whose holder died is reaped, and a live holder's lock never is

  Every writer on the shared master checkout - the coordinator's close,
  the front desk's Approve, Reject and Amend commits, operator_file_question.bb,
  the specifier's mint - serialises through commit_integrity_lib.bb's lock
  directory `.git/swarmforge-commit-integrity.lock`. acquire-lock! polls
  fs/create-dir for a bounded five seconds and gives up with lock-timeout;
  nothing ever removes a directory whose creator has died. On 2026-09-08
  the specifier's commit was in flight at 07:53:29 BST when the swarm
  respawned at 07:55; the empty lock directory survived, and every later
  writer failed `{"success":false,"reason":"lock-timeout","attempts":0}`
  until the next specifier removed it by hand. A caller that finds the
  lock held now asks who holds it: a recorded owner that is no longer
  alive, or a record-less directory older than the age bound, is reaped
  and the acquisition retried; a lock whose owner is alive is never
  touched, whatever its age. Every scenario runs against a fixture
  repository under mkdtemp (BL-1390); the lock directory is planted by
  the test, never left by a real crash.

  Background:
    Given a fixture repository with a shared checkout and one ticket YAML edited on disk

  # BL-1497 a-lock-whose-recorded-owner-is-dead-is-reaped-01
  Scenario: a lock whose recorded owner is dead is reaped and the commit lands
    Given the lock directory exists and its owner record names a process that has exited
    When a writer commits the ticket YAML through the commit-integrity CLI
    Then the commit lands on the first attempt
    And the result names the reaped lock's dead owner
    And the lock directory is absent afterwards

  # BL-1497 a-lock-whose-recorded-owner-is-alive-is-never-reaped-02
  Scenario: a lock whose recorded owner is alive is never reaped
    Given the lock directory exists and its owner record names a process that is still running
    When a writer commits the ticket YAML through the commit-integrity CLI
    Then the result is lock-timeout with no attempt made
    And the lock directory still names the same owner afterwards

  # BL-1497 a-record-less-lock-is-reaped-only-past-the-age-bound-03
  Scenario Outline: a record-less lock is reaped only once it is older than the age bound
    Given the lock directory exists with no owner record and its age is <age> the age bound
    When a writer commits the ticket YAML through the commit-integrity CLI
    Then the result is <result>
    And the lock directory is <state> afterwards

    Examples:
      | age    | result       | state   |
      | past   | success      | absent  |
      | within | lock-timeout | present |

  # BL-1497 an-acquirer-records-its-ownership-while-it-holds-the-lock-04
  Scenario: an acquirer records its ownership for as long as it holds the lock
    Given no lock directory exists
    When a writer commits the ticket YAML with its commit step held open
    Then while the commit step is held the lock directory's owner record names the writer's own process
    And the lock directory is absent afterwards
