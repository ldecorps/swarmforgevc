# mutation-stamp: sha256=225cbeb0f26c7a9b4183ce81ca67d45dbd762ab8a7eea11aed201db27796f341
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-03T06:31:46.291055600Z","feature_name":"BL-1850 A local-model seat records the settings it starts with","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1850-a-local-model-seat-records-the-settings-it-starts-with.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the fingerprint changes only when a setting changes","scenario_hash":"6149dea6f95271c8fde82ce715a1ec332be9f6a8d76fc74d95ec6cdb56715790","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-10-03T06:31:46.291055600Z"},{"index":3,"name":"the seat still starts when a source does not answer","scenario_hash":"e6b66708f2eff0be76d9826b8e425bf6dcf66391e09a14d11dbda76de02bd67e","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-10-03T06:31:46.291055600Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1850 A local-model seat records the settings it starts with

  coder@iq3 is tuned by changing settings: the model's num_ctx and
  num_predict, qwen's contextWindowSize and think flag, the compact card,
  and the GPU itself. On 2026-09-30 the human lowered the card's power
  limit from 180 W to 150 W mid-session, and prefill fell about 10%. The
  seat's own records showed every request's time to first token, tokens
  and tool calls, but nothing said which settings were in force when a
  request ran. A change in behaviour could not be tied to the change in a
  setting that caused it. Every start of a local-model seat now appends
  one row to the seat's settings record, holding what it starts with and
  a fingerprint that changes only when a setting does. Running the same
  snapshot by hand after a change made outside the swarm appends a row
  the same way.

  # BL-1850 a-start-records-its-settings-01
  Scenario: a seat start appends one row with the settings it starts with
    Given Ollama 0.32.15 serves "ista-iq3s-coder:latest" with num_ctx 49152 and num_predict 4096
    And the seat's qwen settings give that model contextWindowSize 49152 and think false
    And the seat's card is a 3735-byte file
    And the GPU reports a 150 W power limit against a 180 W default
    When the settings snapshot runs for the seat "coder@iq3"
    Then one row is appended to the settings record of "coder@iq3"
    And the row carries num_ctx 49152, num_predict 4096, Ollama 0.32.15, contextWindowSize 49152, think false and the card's sha256
    And the row carries the GPU power limit 150 W and its default 180 W

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
      | a lower GPU power limit    | different from |

  # BL-1850 no-credential-is-recorded-03
  Scenario: a credential in qwen's settings never reaches the record
    Given the seat's qwen provider entry carries an apiKey value "sk-fixture-not-a-real-key"
    When the settings snapshot runs for the seat "coder@iq3"
    Then no row in the settings record contains "sk-fixture-not-a-real-key"

  # BL-1850 a-silent-source-never-stops-the-seat-04
  Scenario Outline: the seat still starts when a source does not answer
    Given <source> is not answering
    When the settings snapshot runs for the seat "coder@iq3"
    Then it exits 0 within 3 seconds
    And the appended row marks the <fields> unknown

    Examples:
      | source     | fields          |
      | Ollama     | Ollama settings |
      | nvidia-smi | GPU settings    |
