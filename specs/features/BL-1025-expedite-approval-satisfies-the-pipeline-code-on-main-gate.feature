# mutation-stamp: sha256=a07bf045820306263e15d6333ad91074662c286371b1c50af5ee06f1fc110790
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T01:38:48.126199Z","feature_name":"work an expedite run's own QA hat approved is not reported as having bypassed QA","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-1025-expedite-approval-satisfies-the-pipeline-code-on-main-gate.feature","background_hash":"37706aab09c50b1651074662e340948bb6942080477a409f974cc8a6e1e4547e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the check reports on the approval actually on file, from either gate","scenario_hash":"015a9fc2f6bff81ced4c8813d0db197b4c4afb766e00202ec4dfcc6f7097d116","mutation_count":24,"result":{"Total":24,"Killed":24,"Survived":0,"Errors":0},"tested_at":"2026-08-22T01:38:48.126199Z"}]}
# acceptance-mutation-manifest-end

Feature: work an expedite run's own QA hat approved is not reported as having bypassed QA

  # BL-1025. Article 4.2's pipeline-code-on-main check asks one question of
  # every commit touching a QA-exclusive path: did QA approve it? The shared
  # predicate answers that from the live pipeline's own traces - the
  # swarmforge-QA ref a QA agent advances by merging, plus the bounce
  # verdicts that veto it. An expedite run is the second constitutionally
  # sanctioned way that code reaches main ("Same gates, no machinery",
  # BL-567): it walks the same role hats and its QA hat gives a real
  # advance-or-bounce verdict, but with the swarm stopped there is no live
  # QA worktree, so swarmforge-QA never moves. Three commits from BL-1021's
  # expedite run tripped the CRIT on 2026-08-21 for exactly that reason.
  #
  # The danger is not the noise. It is that "check whether it was an
  # expedite run, then ignore" becomes the trained response to this alert -
  # precisely the reflex that would wave a real bypass through. So the run's
  # verdict must become something the check can read, and nothing weaker
  # than a verdict may stand in for one: the row where the commit MESSAGE
  # claims an expedite run with no verdict on file is the BL-972 guard, and
  # the row where the store exists but cannot be consulted is the
  # fail-closed one. Both must report, or the fix has traded a false alarm
  # for a real blind spot.

  Background:
    Given a commit touching a QA-exclusive path that has landed on main

  # BL-1025 approval-on-file-decides-the-report-01
  Scenario Outline: the check reports on the approval actually on file, from either gate
    Given the commit <live qa> merged by a live QA agent
    And the expedite QA-hat verdict on file for the commit is <expedite verdict>
    And the commit message <commit message> an expedite run
    When the Article 4.2 pipeline-code-on-main check sweeps main
    Then the check <outcome> the commit as landed outside QA

    Examples:
      | live qa | expedite verdict | commit message      | outcome         |
      | was not | approving        | says nothing about  | does not report |
      | was not | bouncing         | says nothing about  | reports         |
      | was not | absent           | says nothing about  | reports         |
      | was not | unreadable       | says nothing about  | reports         |
      | was not | absent           | claims it came from | reports         |
      | was     | absent           | says nothing about  | does not report |
