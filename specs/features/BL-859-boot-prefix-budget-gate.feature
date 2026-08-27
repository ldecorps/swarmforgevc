# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-12T01:32:29.016197Z","feature_name":"A boot-prefix budget gate the specifier runs before committing an amendment","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-859-boot-prefix-budget-gate.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

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

  # Hardener (BL-234 equivalent-mutant note, 2026-08-12): a soft Gherkin
  # mutation pass single-value-mangles each <chars>/<exit_code> example cell
  # (8 mutants: 5 killed, 3 survived). All 4 exit_code-field mutants (m2, m4,
  # m6, m8) were killed - the scenario's own `Then the gate exits
  # <exit_code>` step catches every one. The 3 survivors are all chars-field
  # mutants that stay on the SAME side of the 44000 boundary as the original
  # value: row 1 (43999 -> 43991, still <= 44000), row 3 (44001 -> 44003,
  # still > 44000), row 4 (65138 -> 65130, still > 44000). verdict()'s
  # :exit-code is a step function - `(if (> size budget) 1 0)` - so any two
  # sizes on the same side of the boundary are indistinguishable to this
  # scenario's only assertion (exit_code), regardless of implementation.
  # Exact-size fidelity (does measure() report precisely the padded tree's
  # target size, not merely "close enough to stay on the right side of
  # 44000") is already exhaustively covered at the unit layer by
  # boot_prefix_budget_gate_lib_test_runner.bb, which asserts the measured
  # size equals the exact target chars for these same four boundary values
  # (43999/44000/44001/65138) plus others - forcing this acceptance scenario
  # to also assert exact size would test measurement fidelity a second time,
  # not this feature's own claim (verdict follows measured size). No
  # artificial assertion was added to force the 3 survivors to die.
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
