Feature: BL-1495 a b.ai gateway seat resolves, launches, survives a respawn and authenticates

  tencentcloud2/glm-5.3-flash is certified for every pipeline role and
  anthropic/claude-fable-5-1 for the specifier, but the launch tooling
  cannot seat either: the staffing gate's host table has no api.b.ai entry
  and its agent-model table no claude-fable-5-1 entry, the pane-launch
  provider map has no case for the host so an aider pane boots without a
  credential, and the respawn and scrub paths know nothing of the key. The
  b.ai gateway is wired the way the Cerebras, Perplexity and Qwen hosts
  already are, and the glm-mono-router pack ships with it.

  Background:
    Given a steward registry fixture where tencentcloud2/glm-5.3-flash is certified for every pipeline role and anthropic/claude-fable-5-1 is certified for the specifier

  # BL-1495 bai-gateway-seat-01
  Scenario Outline: the launch gate resolves the pack's seats
    Given a window line for role "<role>" running agent "<agent>" with "<cli>"
    When the staffing gate evaluates that seat
    Then the seat resolves to steward provider "<provider>" and the gate answers "pass"

    Examples:
      | role      | agent  | cli                                                                  | provider      |
      | coder     | aider  | --model openai/glm-5.3-flash --openai-api-base https://api.b.ai/v1   | tencentcloud2 |
      | specifier | claude | --model claude-fable-5-1                                             | anthropic     |

  # BL-1495 bai-gateway-seat-02
  Scenario Outline: the compat resolver maps the b.ai host and names a missing key
    Given a launch CLI targeting https://api.b.ai/v1 with B_AI_API_KEY "<key>"
    And a shell OPENAI_API_KEY of "sk-real-openai"
    When the OpenAI-compatible pane environment is resolved
    Then the resolved OPENAI_API_KEY is "<mapped_key>", the base is "https://api.b.ai/v1" and the reason is "<reason>"

    Examples:
      | key        | mapped_key | reason          |
      | bai-secret | bai-secret | launch-cli-bai  |
      | absent     | absent     | bai-key-missing |

  # BL-1495 bai-gateway-seat-03
  Scenario: a respawned b.ai seat is handed the same environment the launch gave it
    Given SWARMFORGE_USE_BAI is "1" and B_AI_API_KEY is "bai-secret" in the respawning process
    And a shell OPENAI_API_KEY of "sk-real-openai"
    When the respawn pane environment is derived for role "coder" by both respawn mappings
    Then each carries OPENAI_API_KEY "bai-secret" with OPENAI_API_BASE and OPENAI_BASE_URL "https://api.b.ai/v1"
    And neither carries the shell OPENAI_API_KEY

  # BL-1495 bai-gateway-seat-04
  Scenario: the key never sticks to the tmux server and always reaches an aider pane
    When the provider scrub map and the aider keep set are read from the bb lib and the shell twin
    Then B_AI_API_KEY is in the scrub map of both
    And B_AI_API_KEY is in the aider keep set of both

  # BL-1495 bai-gateway-seat-05
  Scenario: the shipped glm-mono-router pack staffs every window
    Given the shipped pack "glm-mono-router"
    When every window line of the pack is gated under the registry fixture
    Then every window resolves and the gate answers "pass" for each
    And the specifier window runs "claude" on "claude-fable-5-1" and every other window runs "aider" on "openai/glm-5.3-flash" against "https://api.b.ai/v1"
