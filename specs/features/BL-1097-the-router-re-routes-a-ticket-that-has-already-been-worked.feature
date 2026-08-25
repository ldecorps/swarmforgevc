# mutation-stamp: sha256=3bc038fdf2e1a695ede45e116091dd18191251c4bdd4dbdcc1c4e85519ec8889
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T09:57:57.356487011Z","feature_name":"The router never originates a parcel for work already finished","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Routing follows whether the ticket has been dispatched","scenario_hash":"4fb815613ec57db09e5743db8e7a63864657757d638f4813e661717784f20eff","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T09:57:57.356487011Z"}]}
# acceptance-mutation-manifest-end

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
