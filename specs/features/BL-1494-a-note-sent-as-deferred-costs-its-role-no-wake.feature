Feature: BL-1494 a note sent as deferred costs its role no wake

  The human ruled on BL-1361 that the post-QA branch sweep wakes a role only
  for a dirty worktree and defers every other reason. The shipped tell honours
  that at send time only: the daemon's delivery hop injects the standard wake
  for every new parcel, so each deferred note still costs a merge-up turn -
  28 to cleaner alone in four hours on 2026-09-08. A note may carry
  wake: defer; it lands in the inbox and no path injects for it.

  Background:
    Given a fixture swarm whose tmux injections are counted, not performed

  # BL-1494 deferred-note-no-wake-01
  Scenario: delivering a deferred note lands it in the inbox and injects nothing
    Given a note to "cleaner" with wake field "defer" in the coordinator's outbox
    When the daemon delivers the outbox
    Then the note is in cleaner's inbox/new
    And the daemon log names that delivery "deliver-notify-skip-deferred"
    And zero injections were performed

  # BL-1494 deferred-note-no-wake-02
  Scenario: an ordinary note still wakes its role
    Given a note to "cleaner" with wake field "absent" in the coordinator's outbox
    When the daemon delivers the outbox
    Then one injection was performed

  # BL-1494 deferred-note-no-wake-03
  Scenario: the chase sweep does not poke a role whose only unread parcels are deferred notes
    Given cleaner's inbox/new holds only a deferred note older than the chase threshold
    When the chase sweep runs
    Then zero injections were performed

  # BL-1494 deferred-note-no-wake-04
  Scenario Outline: the post-QA branch sweep defers every reason but a dirty worktree
    Given the post-QA branch sweep surfaces "cleaner" for "<reason>"
    When the sweep tells the role
    Then the wake field of the note it sends is "<wake>"

    Examples:
      | reason           | wake   |
      | divergent-branch | defer  |
      | in-process-work  | defer  |
      | dirty-worktree   | absent |

  # BL-1494 deferred-note-no-wake-05
  Scenario: the field is note-only
    Given a git_handoff draft carrying "wake: defer"
    When swarm_handoff.sh validates the draft
    Then the draft is refused as an unknown header naming "wake"
