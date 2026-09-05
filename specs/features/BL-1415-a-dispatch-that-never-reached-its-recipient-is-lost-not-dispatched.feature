# mutation-stamp: sha256=f78a5c1c9ca2425b4422e97f5b2e704f2e0d898d25eca393e4f64e96bd0196db
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T21:20:19.073410652Z","feature_name":"BL-1415 The dropped-parcel clock starts when the recipient acts on a dispatch, and the router acts on the same verdict","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1415-a-dispatch-that-never-reached-its-recipient-is-lost-not-dispatched.feature","background_hash":"5d0773ec1efa03f810e9a82e78b42fd5f7e6c01a80a3b43203fd2d25826b502d","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a dispatch the recipient acted on less than the threshold ago is not a drop","scenario_hash":"87ba35e380ac299dea5022051f1604fa6b64cd77585e93bb9278d8c1c2653356","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T21:20:19.073410652Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1415 The dropped-parcel clock starts when the recipient acts on a dispatch, and the router acts on the same verdict

  The dropped-parcel sweep (BL-1301) reports an active ticket as "no parcel
  in flight - possible drop" when it has a dispatch trail, no live mail in
  any role's new or in_process, and the freshest trail event is older than
  the stall threshold (45 minutes). The freshest trail event is read from
  each dispatch file's created_at or enqueued_at only. On 2026-09-05 the
  coordinator's Work notes for BL-1384 (03:27Z) and BL-1402 (03:57Z)
  waited unread in the coder's inbox while the coder finished other
  tickets, were dequeued at 05:14Z, and were completed 39 and 7 seconds
  later. The instant live mail cleared, the sweep saw a trail 1h48m old
  and no parcel, and reported both as possible drops; the router refused
  the repair as DISPATCHED, which was correct, and --force sent duplicate
  Work notes to a coder that was already starting BL-1402.

  This feature is that the stall clock starts from the freshest of the
  dispatch's creation, its dequeue and its completion by the recipient, so
  a recipient that just picked a dispatch up is never a drop; that a
  dispatch completed long ago with no parcel and no work anywhere IS a
  drop; and that the router routes on that verdict without --force,
  warning what it repairs, because the sweep, the CLI and the router share
  one predicate.

  Background:
    Given a fixture mailbox tree for coordinator and coder with an active ticket BL-9001 and a fixture clock

  # BL-1415 unread-dispatch-is-in-flight-01
  Scenario: a dispatch note still unread in the recipient's inbox past the stall threshold is not a drop
    Given the coordinator's Work note for BL-9001 sits in the coder's new mailbox, created 2 hours ago
    When the sweep decides whether BL-9001 is dropped
    Then it is not dropped
    And route_backlog_to_coder.sh refuses BL-9001 without --force

  # BL-1415 a-just-completed-dispatch-is-not-a-drop-02
  Scenario Outline: a dispatch the recipient acted on less than the threshold ago is not a drop
    Given the coordinator's Work note for BL-9001 was created 2 hours ago and the coder's copy carries <event> 30 seconds ago
    And no parcel for BL-9001 is in flight anywhere
    When the sweep decides whether BL-9001 is dropped
    Then it is not dropped

    Examples:
      | event        |
      | dequeued_at  |
      | completed_at |

  # BL-1415 a-long-completed-dispatch-with-nothing-after-it-is-a-drop-03
  Scenario: a dispatch completed past the threshold with no parcel and no work anywhere is a drop the router repairs
    Given the coder completed the Work note for BL-9001 50 minutes ago
    And no handoff for BL-9001 sits in any mailbox state after it and no role branch carries a BL-9001 commit
    When the sweep decides whether BL-9001 is dropped
    Then it is dropped and the sweep nudges the coordinator
    And route_backlog_to_coder.sh routes BL-9001 without --force, warning that the earlier dispatch was completed with no parcel and naming it

  # BL-1415 a-parcel-anywhere-means-worked-04
  Scenario: a git_handoff for the ticket in any worktree mailbox state means the ticket was worked and the router refuses
    Given the coder completed the Work note for BL-9001 2 hours ago and a git_handoff for BL-9001 sits in the cleaner's completed mailbox
    When the sweep decides whether BL-9001 is dropped
    Then it is not dropped
    And route_backlog_to_coder.sh refuses BL-9001 without --force

  # BL-1415 sweep-cli-and-router-agree-05
  Scenario: the CLI prints the same verdict and reason the sweep and the router used
    Given the coder completed the Work note for BL-9001 50 minutes ago
    And no handoff for BL-9001 sits in any mailbox state after it and no role branch carries a BL-9001 commit
    When dispatch_trail_cli.bb is asked about BL-9001
    Then it prints DROPPED with the same reason the sweep's nudge carried
