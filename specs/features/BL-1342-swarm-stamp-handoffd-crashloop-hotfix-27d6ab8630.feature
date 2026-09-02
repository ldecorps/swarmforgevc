Feature: Stamp-off review of the handoffd crash-loop hotfix

  BL-848 review-only certification of landed commit 27d6ab8630, which fixed
  two bugs that compounded into the 2026-09-02 crash loop: poll-once! read a
  listed outbox parcel outside the try that wraps deliver!, so a parcel the
  sending role archived mid-poll killed the daemon; and the supervisor's
  first check! ran before its first sleep, so a freshly relaunched daemon
  read :stalled on evidence that was stale by construction and the swarm was
  halted again.

  These scenarios confirm or refute what landed; none of them may rewrite it,
  and none of them writes a certify or waive decision into
  backlog/hotfix-ledger.yaml - only a recorded human decision does that.

  Both halves of the hotfix make something STOP being fatal, so the review is
  weighted toward the two things that bound that: the swallow is narrow (I/O
  only, parcel untouched), and the grace can only ever soften :stalled.

  Background:
    Given the handoff daemon is polling role outboxes

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-01
  Scenario: A parcel that vanishes between listing and read does not kill the daemon
    Given an outbox parcel that is unreadable when the poll reads it
    When the poll runs
    Then the daemon survives the poll
    And the unreadable parcel is recorded as skipped for this poll

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-02
  Scenario: A skipped parcel is left exactly where it was
    Given an outbox parcel that is unreadable when the poll reads it
    When the poll runs
    Then that parcel is neither delivered nor archived nor modified
    And it is re-evaluated on the next poll

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-03
  Scenario: The guard swallows only I/O conditions
    Given a parcel read that fails with a non-I/O error
    When the poll runs
    Then that error is not reported as a vanished parcel

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-04
  Scenario: Deliverable parcels are unaffected by the guard
    Given an outbox parcel that reads normally
    When the poll runs
    Then that parcel is delivered exactly as it was before the hotfix

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-05
  Scenario Outline: The startup grace applies only to a daemon younger than one stall window
    Given a live daemon whose age is "<age>" and whose observations otherwise read stalled
    When the supervisor evaluates health
    Then the verdict is "<verdict>"

    Examples:
      | age                        | verdict  |
      | younger than a stall window | healthy  |
      | older than a stall window   | stalled  |
      | unknown                     | stalled  |

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-06
  Scenario: The grace never rescues a daemon that is not running
    Given a daemon that is not alive and whose age is younger than a stall window
    When the supervisor evaluates health
    Then the verdict is "dead"

  # BL-1342 swarm-stamp-handoffd-crashloop-hotfix-07
  Scenario: The stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
