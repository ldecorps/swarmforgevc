# mutation-stamp: sha256=6a9c3c5afdbfab030e095fd39ebc6297e1616928cba96d67df5c27ecc6930b7e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-07T23:48:36.715482Z","feature_name":"A hotfix is not an official swarm deal until it is certified, and the human is asked first","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature","background_hash":"b7e5e79e56817a96fc7ef95967f6120cf0b56cfe79a8b4120cf51707abae8c61","implementation_hash":"unknown","scenarios":[{"index":3,"name":"a hotfix whose review is still short of a human decision is never certified","scenario_hash":"2672b5772e54f5d7d71de8f354432997884c8d65775434a641c6289e8357b148","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-07T23:48:36.715482Z"},{"index":4,"name":"only a recorded human decision closes an entry","scenario_hash":"138b1661828a49419f30013d6f1fe319d2ad0e5b72367d1aabfa731303a5a54d","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-07T23:48:36.715482Z"}]}
# acceptance-mutation-manifest-end

Feature: A hotfix is not an official swarm deal until it is certified, and the human is asked first
  Operator hotfixes land straight on main, outside the pipeline. Today nothing
  tracks them: BL-810's hotfix was certified only because a human happened to
  ask for BL-811, and the Darwin orphan-janitor fix (f9cf29c2, 2026-08-07) sat
  as a root intake with no detector at all. This feature gives the swarm a
  durable ledger of hotfixes, a recurrent check that will not let an open entry
  go quiet, and a hard rule that no hotfix becomes an official deal on green
  tests alone — a human is asked first.

  Detection is DECLARED, not inferred. The specifier measured every derived
  predicate over 600 commits of main and each one failed on a real hotfix:
  "no `By <role>.` byline" misses 2b8d19d1 (the BL-811 hotfix, committed by the
  specifier on the human's behalf, so it carries a byline), and "names no
  ticket id" misses both known hotfixes. Worse, "names a ticket that reached
  done" FALSELY CERTIFIES f9cf29c2, whose body cites BL-811 only as a posture
  reference. A hotfix is therefore whatever a landing DECLARES itself to be;
  the derived sweep is a review queue with known false negatives, never truth.

  Background:
    Given a hotfix certification ledger that records one entry per hotfix commit
    And a recurrent check that runs on an already-existing daemon loop

  # BL-848 hotfix-certification-01
  Scenario: a declared hotfix enters the ledger and starts life uncertified
    Given a functional change lands on main declaring itself a hotfix
    When the recurrent check runs
    Then the ledger holds an entry for that commit
    And that entry is not certified

  # BL-848 hotfix-certification-02
  Scenario: an open entry is surfaced every time the check runs, not only once
    Given a ledger entry that is still open
    And the check has already surfaced that entry on an earlier run
    When the recurrent check runs again after the resurfacing interval
    Then it surfaces that entry again
    And it keeps doing so until the entry is resolved

  # BL-848 hotfix-certification-03
  Scenario: an uncertified hotfix with no review ticket is routed for one
    Given a ledger entry with no stamp ticket recorded
    When the recurrent check runs
    Then it asks the coordinator to get a stamp ticket minted for that commit

  # BL-848 hotfix-certification-04
  Scenario Outline: a hotfix whose review is still short of a human decision is never certified
    Given a ledger entry whose stamp ticket <ticket state>
    When the recurrent check runs
    Then that entry is not certified
    And it is still surfaced as outstanding

    Examples:
      | ticket state                                |
      | is still moving through the pipeline        |
      | has passed QA but carries no human decision |

  # BL-848 hotfix-certification-05
  Scenario Outline: only a recorded human decision closes an entry
    Given a ledger entry whose stamp ticket has passed QA
    And the human has recorded a decision of <decision>
    When the recurrent check runs
    Then that entry is resolved as <outcome>
    And it is no longer surfaced as outstanding

    Examples:
      | decision | outcome   |
      | approval | certified |
      | waiver   | waived    |

  # BL-848 hotfix-certification-06
  Scenario: the check never awards certification on its own
    Given a ledger entry whose stamp ticket has passed QA
    And the human has recorded no decision
    When the recurrent check runs
    Then the check writes no resolved state for that entry
    And the entry still awaits the human

  # BL-848 hotfix-certification-07
  Scenario: a functional landing that no ledger entry and no ticket accounts for is queued for disposition
    Given a functional change on main that declares no hotfix
    And no ledger entry and no pipeline record claims that commit
    When the recurrent check runs
    Then it reports that commit as unaccounted for
    And it says the report is a review queue, not a certification verdict

  # BL-848 hotfix-certification-08
  Scenario: a landing the ledger already knows about is not queued a second time
    Given a functional change on main that a ledger entry already covers
    When the recurrent check runs
    Then it does not report that commit as unaccounted for
