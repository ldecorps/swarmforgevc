Feature: BL-1850 A local-model seat records the settings it starts with

  coder@iq3 is tuned by changing settings: the model's num_ctx and
  num_predict, qwen's contextWindowSize and think flag, the compact card.
  On 2026-09-30 the seat's own records showed every request's time to
  first token, tokens and tool calls, but nothing said which settings were
  in force when a request ran. A change in behaviour could not be tied to
  the change in a setting that caused it. Every start of a local-model
  seat now appends one row to the seat's settings record, holding what it
  starts with and a fingerprint that changes only when a setting does.

  # BL-1850 a-start-records-its-settings-01
  Scenario: a seat start appends one row with the settings it starts with
    Given Ollama 0.32.15 serves "ista-iq3s-coder:latest" with num_ctx 49152 and num_predict 4096
    And the seat's qwen settings give that model contextWindowSize 49152 and think false
    And the seat's card is a 3735-byte file
    When the settings snapshot runs for the seat "coder@iq3"
    Then one row is appended to the settings record of "coder@iq3"
    And the row carries num_ctx 49152, num_predict 4096, Ollama 0.32.15, contextWindowSize 49152, think false and the card's sha256

  # BL-1850 the-fingerprint-moves-only-with-a-setting-02
  Scenario Outline: the fingerprint changes only when a setting changes
    Given the seat's first start is already recorded
    When the seat starts again with <change>
    Then the new row's fingerprint is <fingerprint> the first row's

    Examples:
      | change                     | fingerprint    |
      | nothing changed            | the same as    |
      | num_ctx 40960              | different from |
      | one byte added to the card | different from |

  # BL-1850 no-credential-is-recorded-03
  Scenario: a credential in qwen's settings never reaches the record
    Given the seat's qwen provider entry carries an apiKey value "sk-fixture-not-a-real-key"
    When the settings snapshot runs for the seat "coder@iq3"
    Then no row in the settings record contains "sk-fixture-not-a-real-key"

  # BL-1850 an-absent-ollama-never-stops-the-seat-04
  Scenario: the seat still starts when Ollama is not answering
    Given Ollama is not answering
    When the settings snapshot runs for the seat "coder@iq3"
    Then it exits 0 within 3 seconds
    And the appended row marks the Ollama settings unknown
