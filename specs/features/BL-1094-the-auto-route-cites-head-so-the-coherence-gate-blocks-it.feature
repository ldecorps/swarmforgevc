# mutation-stamp: sha256=0637c9a141704073a1cd5d4bc835880963c943d0eb204b771ebbf6c347f4e992
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T07:37:09.254823531Z","feature_name":"The daemon can deliver the auto-route it generates","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"An auto-route is delivered whatever HEAD's subject names","scenario_hash":"2a880acf984887545f11da55025a1298025302287275b2ca393798810a7076a1","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T07:37:09.254823531Z"}]}
# acceptance-mutation-manifest-end

Feature: The daemon can deliver the auto-route it generates

  A ticket sitting active with no dispatch trail is auto-routed by the
  daemon's dispatch-gap sweep. That parcel cites HEAD as its commit, because
  there is no ticket-specific commit to cite - the parcel says "here is work
  to pick up", not "here is the work I did".

  The BL-953 coherence gate reads the cited commit's subject and refuses a
  git_handoff whose task is not among the ticket ids that subject names. For
  a hand-authored hop that catch is exactly right. For this generated parcel
  the premise does not hold, and since HEAD's subject nearly always names
  some other ticket, the auto-route is refused almost every time.

  The stale-draft catch itself must survive whatever fixes this.

  # BL-1094 autoroute-deliverable-01
  Scenario Outline: An auto-route is delivered whatever HEAD's subject names
    Given an active ticket with a real assignee and no dispatch trail
    And HEAD's commit subject names <subject-names>
    When the daemon runs its dispatch-gap sweep
    Then the assignee receives the parcel

    Examples:
      | subject-names        |
      | a different ticket   |
      | the routed ticket    |
      | no ticket at all     |

  # BL-1094 autoroute-deliverable-02
  Scenario: A hand-authored handoff with a contradicting commit is still refused
    Given a hand-authored git_handoff whose task and commit name different tickets
    When the sender submits it
    Then the send is refused
    And the refusal names the coherence gate

  # BL-1094 autoroute-deliverable-03
  Scenario: A refused auto-route says which gate refused it
    Given an auto-route the validator refuses
    When the daemon logs the failure
    Then the log line names the refusing gate and its reason
