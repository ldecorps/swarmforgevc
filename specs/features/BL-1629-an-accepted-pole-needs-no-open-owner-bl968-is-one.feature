Feature: BL-1629 An accepted pole needs no open owner, and bl968 is one

  The pole register knows only rows that an open ticket owns and will cut;
  a row reads unowned the day its ticket closes and stale the day its file
  gets fast. This feature is that a register row may carry a disposition -
  owned, or accepted with a rationale and a re-measure date - that an
  accepted row is printed on every run and never refused as unowned or
  new-pole while it is still reported stale when its file gets fast, and
  that a file with no row is still a new pole.

  bl968StepRegistryMaterializedTreeGuard.test.js prompted it: its two full
  step-registry loads cost over twelve seconds of require time when this
  was specified. BL-1630 (landed 2026-09-21) brought it to under three
  seconds, so its row leaves the register instead of becoming the first
  accepted one, and the scenario that asserted it was retired on
  2026-10-06. The Feature line keeps its original name because the step
  handler is scoped by it.

  # BL-1629 accepted-pole-needs-no-open-owner-01
  Scenario Outline: the reader accepts both row shapes
    Given a pole register row written <shape>
    When the register is read
    Then the row's disposition reads <disposition>

    Examples:
      | shape                                        | disposition |
      | in the five-column form with no disposition  | owned       |
      | with the disposition column set to accepted  | accepted    |

  # BL-1629 accepted-pole-needs-no-open-owner-02
  Scenario Outline: the verdict for a row follows its disposition and its measurement
    Given a pole register holding <row> and a measured duration of <measured> ms against a 7000 ms budget
    When the suite file budget verdict is computed
    Then the verdict for that file is <verdict>
    And the printed line <mentions>

    Examples:
      | row                                                | measured | verdict     | mentions                              |
      | an accepted row naming a closed ticket             | 12600    | accepted    | its rationale and re-measure date     |
      | an accepted row naming a closed ticket             | 5000     | stale-row   | the file and its ticket               |
      | an owned row naming a closed ticket                | 12600    | unowned-row | the file and its ticket               |
      | no row at all                                      | 12600    | new-pole    | the file                              |
