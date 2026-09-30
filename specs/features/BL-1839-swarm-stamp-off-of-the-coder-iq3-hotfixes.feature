Feature: BL-1839 Swarm stamp-off of the coder@iq3 hotfixes

  On 2026-09-30 the specifier, at the human's direction, took over an
  operator hotfix in progress and landed it on main with two follow-ups,
  outside the pipeline: 2cdb259806, 7f38e5d7fe and 91c208a923. They let
  the coder@iq3 local-model seat launch, fit its window, run on the GPU
  and start from its card instead of the whole constitution. This review
  pins what landed, so the next change to the launch path cannot quietly
  undo it, and reports anything the hotfixes left open.

  # BL-1839 the-window-gate-measures-the-stages-card-01
  Scenario: the window gate measures a seat's stage card, not the full constitution
    Given a pack whose window line is "window coder@iq3 local-model coder-iq3 --model ista-iq3s-coder:latest"
    When the swarm checks the seat's window at launch
    Then the prompt the gate measures is the composed local-model coder card
    And that prompt is at most 8192 characters

  # BL-1839 the-qwen-launch-drops-seat-tier-02
  Scenario: the qwen launch line drops --seat-tier while the window line keeps it
    Given a pack whose window line is "window coder@iq3 local-model coder-iq3 --model ista-iq3s-coder:latest --seat-tier easy"
    When the swarm writes the seat's launch script
    Then the qwen command in it carries no "--seat-tier"
    And the seat's claim tier still reads "easy"

  # BL-1839 a-loopback-base-gets-the-ollama-key-03
  Scenario Outline: start-swarm uses the Ollama key only for a loopback OpenAI base
    Given a throwaway HOME whose .zshenv exports OPENAI_API_KEY "cloud-key-fixture"
    And OPENAI_API_BASE is "<base>"
    When start-swarm.sh prepares the launch environment
    Then OPENAI_API_KEY in it is "<key>"

    Examples:
      | base                       | key               |
      | http://127.0.0.1:11434/v1  | ollama            |
      | https://api.example.com/v1 | cloud-key-fixture |

  # BL-1839 the-ollama-start-quantises-the-kv-cache-04
  Scenario Outline: the swarm's Ollama start enables flash attention and a q8_0 KV cache unless the caller chose
    Given the caller sets OLLAMA_KV_CACHE_TYPE to "<caller>"
    When the swarm starts its Ollama server
    Then the server starts with OLLAMA_FLASH_ATTENTION "1" and OLLAMA_KV_CACHE_TYPE "<served>"

    Examples:
      | caller  | served |
      | (unset) | q8_0   |
      | f16     | f16    |

  # BL-1839 the-local-card-keeps-the-seat-on-its-ticket-05
  Scenario: the local-model card tells the seat to start from its loop, read in parts and edit in small pieces
    When the prompt factory composes the "coder" prompt for the "local-model" agent
    Then it tells the seat not to read the constitution, PIPELINE or its full role prompt when it starts
    And it tells the seat to read a large file in parts and to change an existing file with the edit tool
    And it still names swarmforge/roles/coder.prompt and swarmforge/constitution.prompt
