Feature: A boot-prefix budget gate the specifier runs before committing an amendment

  # BL-859: the 51200-char boot-prefix cap is enforced only by
  # swarmforge/scripts/test/prompt_engine_test_runner.bb, which nobody runs
  # when amending the constitution. The specifier commits article growth
  # straight to main, so an over-cap prefix is discovered later, by an
  # unrelated parcel, as a RED that reviewers are then told to treat as
  # known-pre-existing - normalized red. This has now happened twice
  # (BL-618 at 53408 chars, BL-858 at 65138). This gate moves the check to
  # the moment the growth is authored, and fails at a budget BELOW the cap
  # so the band between budget and cap absorbs amendments landing between
  # gate runs.

  # BL-859 budget-verdict-01
  Scenario Outline: the gate's verdict follows the measured boot prefix size
    Given a constitution tree whose boot prefix measures <chars> characters
    When the boot prefix budget gate runs
    Then the gate exits <exit_code>

    Examples:
      | chars | exit_code |
      | 43999 | 0         |
      | 44000 | 0         |
      | 44001 | 1         |
      | 65138 | 1         |

  # BL-859 measures-what-boot-composes-02
  Scenario: the gate measures the same text the agent boot composes
    Given the constitution tree as it stands in the repository
    When the boot prefix budget gate runs
    Then the size it reports equals the stable prefix length the prompt engine composes

  # BL-859 reference-bodies-excluded-03
  Scenario: prose already moved to reference files does not count against the budget
    Given a constitution tree with a reference file under "swarmforge/constitution/articles/reference/"
    When the boot prefix budget gate runs
    Then the reported size excludes that reference file's body

  # BL-859 actionable-remedy-04
  Scenario: a failing gate says how far over budget the prefix is
    Given a constitution tree 21138 characters over the budget
    When the boot prefix budget gate runs
    Then the gate output states the measured size, the budget, and the number of characters to move

  # BL-859 specifier-mandated-05
  Scenario: the specifier is instructed to run the gate before committing an amendment
    Given the specifier role prompt
    When it is read for the amendment-commit procedure
    Then it names the boot prefix budget gate as a required step before committing a boot-inlined article change
