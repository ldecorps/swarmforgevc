# mutation-stamp: sha256=635aebcb586e4e5712c6907d6972306e6df3995aa54f075f2112cc3b7627e2ec
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-10T09:31:21.305132523Z","feature_name":"BL-1494 a note sent as deferred costs its role no wake","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1494-a-note-sent-as-deferred-costs-its-role-no-wake.feature","background_hash":"2ac8ad6e01685497324fd9f0b9e4f1fea134e9966cd477b5849b9383c2cfb491","implementation_hash":"unknown","scenarios":[{"index":3,"name":"the post-QA branch sweep defers every reason but a dirty worktree","scenario_hash":"8f74889f3dc1db2cb53c72ea42050ce0ece4bcf43c98ec9ca247d88dbc2688f4","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-10T09:31:21.305132523Z"}]}
# acceptance-mutation-manifest-end

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
