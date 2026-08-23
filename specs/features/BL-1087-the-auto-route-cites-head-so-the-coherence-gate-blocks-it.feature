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

  # BL-1087 autoroute-deliverable-01
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

  # BL-1087 autoroute-deliverable-02
  Scenario: A hand-authored handoff with a contradicting commit is still refused
    Given a hand-authored git_handoff whose task and commit name different tickets
    When the sender submits it
    Then the send is refused
    And the refusal names the coherence gate

  # BL-1087 autoroute-deliverable-03
  Scenario: A refused auto-route says which gate refused it
    Given an auto-route the validator refuses
    When the daemon logs the failure
    Then the log line names the refusing gate and its reason
