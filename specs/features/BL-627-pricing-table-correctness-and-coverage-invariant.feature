Feature: pricing table carries correct rates and a fail-loud coverage invariant

  # BL-627: rates in PRICING_TABLE were verified against Anthropic's published
  # pricing and found wrong (claude-opus-4-8 3x overstated at the old Opus 4.1
  # rate, claude-fable-5 1.5x overstated, claude-haiku-4-5-20251001 ~20%
  # understated), and claude-opus-5 (now driving the architect seat) had no
  # entry at all — a model can enter service and silently produce no cost
  # attribution. The fix corrects the table and adds a deterministic,
  # network-free coverage check; it deliberately does NOT add a cron-based
  # auto-updater (operator explicitly rejected that shape 2026-07-25).

  # BL-627 corrected-rate-per-model-01
  Scenario Outline: PRICING_TABLE carries the corrected or newly-added rate for each known model
    Given PRICING_TABLE_VERSION is bumped from its prior value
    When PRICING_TABLE is read for "<model>"
    Then its input and output per-MTok rates are "<input rate>" and "<output rate>"

    Examples:
      | model                        | input rate | output rate |
      | claude-opus-4-8              | $5         | $25         |
      | claude-fable-5                | $10        | $50         |
      | claude-haiku-4-5-20251001    | $1         | $5          |
      | claude-opus-5                 | $5         | $25         |

  # BL-627 unpriced-model-in-service-fails-loud-02
  Scenario: a model referenced by conf/pack/launch-settings but absent from the table fails loud
    Given a fixture conf file references model "claude-unpriced-test-model"
    And PRICING_TABLE has no entry for "claude-unpriced-test-model"
    When the pricing coverage check runs
    Then it fails
    And the failure names "claude-unpriced-test-model"

  # BL-627 current-roster-passes-03
  Scenario: the current repo's model roster passes the coverage check
    Given every model referenced by swarmforge.conf, swarmforge/packs/*.conf, and .swarmforge/launch/*.claude-settings.json
    When the pricing coverage check runs
    Then it passes
