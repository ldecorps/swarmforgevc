Feature: BL-1629 An accepted pole needs no open owner, and bl968 is one

  The pole register knows only rows that an open ticket owns and will cut;
  a row reads unowned the day its ticket closes and stale the day its file
  gets fast. bl968StepRegistryMaterializedTreeGuard.test.js will not get
  fast: its two full step-registry loads are what it proves, and one load
  costs over twelve seconds of require time today. This feature is that a
  register row may carry a disposition - owned, or accepted with a
  rationale and a re-measure date - that an accepted row is printed on
  every run and never refused as unowned or new-pole while it is still
  reported stale when its file gets fast, that a file with no row is still
  a new pole, and that bl968's row is the first accepted one with its
  temp-dir sweep scoped to its own runs. bl968's long solo run is QA's e2e
  step, not a scenario (BL-1541).

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

  # BL-1629 accepted-pole-needs-no-open-owner-03
  Scenario: bl968's row is accepted and its sweep is scoped to its own runs
    When the real pole register and the source of extension/test/bl968StepRegistryMaterializedTreeGuard.test.js are read
    Then the bl968 row carries the disposition accepted with a re-measure date
    And the test builds its temp roots with its own pid in the name and never lists the temp dir itself
