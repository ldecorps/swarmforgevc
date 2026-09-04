Feature: The mandatory land decide step refuses a tip carrying an unlanded ticket

  QA's landing step is `land_main_publish.sh <root> --decide-only`, then
  `git push origin HEAD:main`. The entangled-sibling detector BL-1241 built
  and BL-1308 widened lives in `land_step_lib.bb`'s `entangled-siblings` and
  is reached only through `land_step_cli.bb`, which QA runs by hand when it
  notices entanglement. The mandatory decide step consults neither, so a
  plain push of the QA branch tip ships every ticket previously merged into
  that branch, checked or not.

  The decide step is the only step on the path QA cannot skip, so it is where
  the answer has to be given. Refusing is fail-closed on the ONE fact the
  detector can establish; every input it cannot read fails open, as BL-806
  and BL-1293 established for this family.

  Background:
    Given a branch tip that is a descendant of origin/main
    And a ticket being landed from that tip

  # BL-1309 land-decide-refuses-entangled-tip-01
  Scenario Outline: The decide step answers on what the tip adds over origin/main
    Given the tip adds content authored for <sibling_state>
    When the land decide step runs
    Then it reports <verdict>

    Examples:
      | sibling_state                             | verdict |
      | no ticket but the one being landed        | proceed |
      | a ticket whose content is on origin/main  | proceed |
      | a ticket whose content is not there yet   | refuse  |

  # BL-1309 land-decide-refuses-entangled-tip-02
  Scenario: The 2026-08-31 land that shipped a ticket held for a human ruling
    Given the tip carries the merge of a ticket withheld pending a human ruling
    When the land decide step runs
    Then it reports refuse
    And its output carries the ENTANGLED_SIBLING_BLOCK marker
    And its output names the withheld ticket

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
