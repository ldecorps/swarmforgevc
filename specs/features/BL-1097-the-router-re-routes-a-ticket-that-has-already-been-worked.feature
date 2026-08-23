Feature: The router never originates a parcel for work already finished

  A ticket stays in backlog/active/ from the moment it is promoted until the
  coordinator's separate bookkeeping step moves it to done/. Nothing advances
  its status while it travels, so for that whole window it looks exactly like
  unstarted work to the router.

  Article 1.9 forbids FORWARDING a parcel whose commit produces no functional
  change. The same rule has to bind the router that originates one.

  # BL-1097 no-reroute-worked-01
  Scenario Outline: Routing follows whether the ticket has been dispatched
    Given an active ticket assigned to a role
    And the ticket <trail>
    When the coordinator routes the backlog
    Then a parcel is <outcome> for that ticket

    Examples:
      | trail                        | outcome      |
      | has never been dispatched    | emitted      |
      | already has a dispatch trail | not emitted  |

  # BL-1097 no-reroute-worked-02
  Scenario: Work finished but not yet closed is not routable
    Given an active ticket whose work is complete and QA-approved
    And the ticket has not yet been moved to backlog/done/
    When the coordinator routes the backlog
    Then no parcel is emitted for that ticket

  # BL-1097 no-reroute-worked-03
  Scenario: The router and the dispatch-gap sweep agree
    Given a set of active tickets in mixed dispatch states
    When the router and the dispatch-gap sweep are each asked which are undispatched
    Then the two answers are identical
