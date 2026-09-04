# mutation-stamp: sha256=dd20d3978128bceef7f995c419b7e3f6127d9f7dcb882bf9237f64d9b12ea5e3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T08:29:44.250800256Z","feature_name":"The mandatory land decide step refuses a tip carrying an unlanded ticket","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1309-the-mandatory-land-decide-step-is-blind-to-entanglement.feature","background_hash":"3ee7e2a27318fd33e3e86cfb344a7a2d47d9a80f86335137fcd1d15121af9120","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The decide step answers on what the tip adds over origin/main","scenario_hash":"e80def905339fb627aaa6d09c68547b7dbceee32e543b8820ba4aad9deb871cf","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-09-04T08:29:44.250800256Z"},{"index":3,"name":"An input the step cannot read never becomes a refusal","scenario_hash":"2097d073f9751cc38fdab5dab5be2cb2014b150f797ab5c0ab83e33762adbfa1","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-04T08:29:44.250800256Z"}]}
# acceptance-mutation-manifest-end

Feature: The mandatory land decide step refuses a tip carrying an unlanded ticket

  QA's landing step is `land_main_publish.sh <root> --decide-only`, then
  `git push origin HEAD:main`. The entangled-sibling detector BL-1241 built
  and BL-1308 widened lives in `land_step_lib.bb`'s `entangled-siblings` and
  is reached only through `land_step_cli.bb`, which QA runs by hand when it
  notices entanglement. The mandatory decide step consults neither, so a
  plain push of the QA branch tip ships every ticket previously merged into
  that branch, checked or not.

  The decide step is the only step on the path QA cannot skip, so it is where
  the answer has to be given. Every input the detector itself cannot read
  fails open, as BL-806 and BL-1293 established for this family.

  How WIDE the refusal is was the human's own call, and it was answered twice.
  Option 1 - refuse every entangled tip - shipped first and deadlocked the
  land queue the same day: when several APPROVED tickets share one path, each
  refuses because the others are unlanded and none can go first. BL-1375's
  ruling narrowed it to option 2, which is what these scenarios describe: an
  unlanded sibling that is APPROVED rides, and one that is withheld, awaiting
  approval, or whose approval state cannot be read still refuses. Absence is
  never a ride - only a positive reading of "approved" narrows anything.

  Background:
    Given a branch tip that is a descendant of origin/main
    And a ticket being landed from that tip

  # BL-1309 land-decide-refuses-entangled-tip-01
  Scenario Outline: The decide step answers on what the tip adds over origin/main
    Given the tip adds content authored for <sibling_state>
    When the land decide step runs
    Then it reports <verdict>

    Examples:
      | sibling_state                                        | verdict |
      | no ticket but the one being landed                   | proceed |
      | a ticket whose content is on origin/main             | proceed |
      | an approved ticket whose content is not there yet    | proceed |
      | a ticket withheld in backlog/hold                    | refuse  |
      | a ticket still awaiting its human approval           | refuse  |
      | a ticket whose approval state cannot be read         | refuse  |

  # BL-1309 land-decide-refuses-entangled-tip-02
  Scenario: The 2026-08-31 land that shipped a ticket held for a human ruling
    Given the tip carries the merge of a ticket withheld pending a human ruling
    When the land decide step runs
    Then it reports refuse
    And its output carries the ENTANGLED_SIBLING_BLOCK marker
    And its output names the withheld ticket
    And its output says why that ticket may not ride

  # BL-1309 land-decide-refuses-entangled-tip-04
  Scenario: The deadlock the narrowing exists to dissolve
    Given the tip carries the merge of an approved ticket that has not landed
    When the land decide step runs
    Then it reports proceed
    And its output omits the ENTANGLED_SIBLING_BLOCK marker

  # BL-1309 land-decide-refuses-entangled-tip-03
  Scenario Outline: An input the step cannot read never becomes a refusal
    Given <unreadable_input>
    When the land decide step runs
    Then it reports proceed
    And its output omits the ENTANGLED_SIBLING_BLOCK marker

    Examples:
      | unreadable_input                          |
      | the detector cannot be run at all         |
      | the range against origin/main is unreadable |
