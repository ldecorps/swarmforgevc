Feature: BL-1475 Writers on the shared checkout retry a transient index lock and verify durability before alarming

  Two writers commit bookkeeping on the shared master checkout on their own:
  the front desk's human-decision commit (an Approve, Reject or Amend tap)
  through the commit-integrity CLI, and the daemon's per-ticket topic
  record through commitScopedFile. Every other commit on that checkout
  runs a guard chain that holds git's index lock for seconds. On
  2026-09-07 the human approved BL-1472 and BL-1473 at 18:35 while the
  specifier's mints were committing; both approval commits failed on the
  lock, the front desk told the human "a human must land the change
  manually", and the specifier's next commits swept the flipped files in
  eight seconds later - the approvals were durable, the alarm false, and
  the decision's own commit attribution lost. The same race left 34
  modified and 4 untracked topic records uncommitted across the day, each
  logged as "NOT yet durable" and none retried. A writer retries a lock
  refusal within a bound sized to the guard chain, then checks whether the
  path is already clean against HEAD, and alarms only when it is not.
  Every scenario runs against a fixture repository under mkdtemp with an
  injected lock holder and clock (BL-1390; no real waits).

  Background:
    Given a fixture repository with a shared checkout, a ticket YAML and a topic record, and a second writer that can hold .git/index.lock for an injected duration

  # BL-1475 a-decision-commit-waits-out-a-lock-held-for-seconds-01
  Scenario Outline: a human-decision commit waits out an index lock held for seconds and lands
    Given the second writer holds the index lock for <held> seconds
    When the front desk commits an approval flip for the ticket
    Then the commit lands within the retry bound and no durability alarm is raised

    Examples:
      | held |
      | 3    |
      | 10   |

  # BL-1475 a-lock-held-past-the-bound-alarms-with-gits-reason-02
  Scenario: a lock held past the retry bound is reported with git's own reason
    Given the second writer holds the index lock past the retry bound
    When the front desk commits an approval flip for the ticket
    Then the durability alarm is raised carrying git's index-lock message

  # BL-1475 a-flip-another-writer-already-landed-is-reported-as-landed-03
  Scenario: a flip another writer's commit already landed is reported as landed, never as failed
    Given the second writer's own commit captured the flipped ticket YAML before the front desk's attempt
    When the front desk commits an approval flip for the ticket
    Then no durability alarm is raised
    And the Approvals topic is told the decision landed in that writer's commit, named by sha

  # BL-1475 a-topic-record-commit-retries-and-verifies-the-same-way-04
  Scenario: a topic record commit retries the lock and verifies the same way
    Given the second writer holds the index lock for 3 seconds
    When the daemon commits the topic record
    Then the record is committed within the retry bound and its log carries no not-yet-durable line

  # BL-1475 a-real-failure-logs-gits-stderr-05
  Scenario: a real commit failure logs git's stderr instead of discarding it
    Given a commit hook in the fixture that refuses with a message
    When the daemon commits the topic record
    Then the not-yet-durable line carries the hook's message
