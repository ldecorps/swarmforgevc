Feature: BL-1427 The load guard covers every script it lists and runs none of them

  BL-1395's check_bb_scripts_load.sh promises that every Babashka script a
  commit or a land changes is load-filed against the tree under test,
  "analysis only, its -main guarded". Two things make that promise false
  today. Its while-read loop feeds each script to a bare bb probe whose
  stdin is the loop's own file list, so a script that reads stdin when it
  loads drains the list: on 2026-09-05 --all analysed 107 of 286 scripts,
  stopped at harness_env_scrub_names.bb, and reported the 178 scripts sorted
  after it as if they had passed - post_qa_branch_sweep.bb among them,
  unreadable since 2026-08-26 (BL-1426). And the probe runs each script's
  top-level entry call, so a CLI ending in (apply -main *command-line-args*)
  with a fixed-arity -main throws an arity error under the empty-args probe
  and is refused although it loads: two live scripts today, which no commit
  may now touch.

  This feature is that the guard's verdict covers every script it lists,
  that its pass line claims only the coverage it got, that no script's entry
  point is executed by the probe, and that a real reader or analysis defect
  still refuses naming the file and the symbol. Every scenario runs the guard
  against a fixture tree under a temporary directory whose scripts directory
  holds only fixture scripts, never the live checkout.

  Background:
    Given a fixture tree whose swarmforge scripts directory holds only fixture scripts

  # BL-1427 a-stdin-reader-hides-nothing-sorted-after-it-01
  Scenario: a script that reads stdin when loaded hides nothing sorted after it
    Given a fixture script that reads stdin when it loads
    And a fixture script sorted after it whose body has a reader error
    When the script load guard examines the whole tree
    Then the guard refuses naming the later script

  # BL-1427 the-pass-line-claims-only-the-coverage-it-got-02
  Scenario: the pass line reports exactly the scripts the tree holds
    Given four loadable fixture scripts and nothing else
    When the script load guard examines the whole tree
    Then the guard passes reporting four scripts analysed

  # BL-1427 an-entry-call-is-analysed-never-run-03
  Scenario Outline: a script's top-level entry call is analysed and never run
    Given a loadable fixture CLI whose -main writes a marker file and whose last form is <entry>
    When the script load guard examines the whole tree
    Then the guard passes
    And the marker file was never written

    Examples:
      | entry                             |
      | (apply -main *command-line-args*) |
      | (-main)                           |
      | (-main *command-line-args*)       |

  # BL-1427 a-defect-behind-an-entry-call-still-refuses-04
  Scenario: an analysis defect in a script that ends in an entry call still refuses
    Given a fixture CLI whose -main calls a function defined nowhere and whose last form is an apply of -main
    When the script load guard examines the whole tree
    Then the guard refuses naming the file and the unresolved symbol
