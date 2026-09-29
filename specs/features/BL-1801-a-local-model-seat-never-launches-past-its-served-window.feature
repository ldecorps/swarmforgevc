Feature: BL-1801 A local-model seat never launches past its served window

  A local model silently drops whatever overflows the window Ollama serves
  it, so a seat whose first turn does not fit loses its role instructions
  and simply looks bad at tools. After Ollama is ready and before any pane
  starts, the launch estimates each local-model seat's first turn: its
  composed prompt plus the qwen CLI's own recorded overhead, at three
  characters a token. It compares that with the num_ctx Ollama reports
  for the seat's model, or, when the model sets none, the context length
  the swarm started the server with. Human ruling 2026-09-29 (in chat):
  the window source is the running Ollama. The launch refuses when the
  window is known and the first turn does not fit, warns when the first
  turn takes more than half the window, warns when the window is unknown,
  and a human override turns a refusal into a warning. Every scenario
  runs against a fake Ollama and fixture prompt files; none touches the
  live server.

  Background:
    Given a pack whose coder seat runs the "local-model" agent against a fake Ollama

  # BL-1801 the-launch-decides-from-the-served-window-01
  Scenario Outline: the launch decides from the window Ollama serves the seat's model
    Given the fake Ollama reports num_ctx "<num_ctx>" for the coder's model
    And the coder's composed first turn is <prompt chars> characters and the recorded CLI overhead is 3000 characters
    When the launch checks the local-model seats' windows
    Then it "<outcome>"

    Examples:
      | num_ctx | prompt chars | outcome                              |
      | 32768   | 6000         | proceeds with no window message      |
      | 8192    | 15000        | warns and proceeds                   |
      | 4096    | 15000        | refuses the launch before any pane starts |

  # BL-1801 the-swarms-context-length-stands-in-02
  Scenario: the context length the swarm started Ollama with stands in when the model sets none
    Given the fake Ollama reports num_ctx "none" for the coder's model
    And the swarm started Ollama with context length "4096"
    And the coder's composed first turn is 15000 characters and the recorded CLI overhead is 3000 characters
    When the launch checks the local-model seats' windows
    Then it "refuses the launch before any pane starts"

  # BL-1801 an-unknown-window-warns-and-never-refuses-03
  Scenario: an unknown window warns and never refuses
    Given the fake Ollama reports num_ctx "none" for the coder's model
    And the swarm started Ollama with context length "none"
    And the coder's composed first turn is 60000 characters and the recorded CLI overhead is 3000 characters
    When the launch checks the local-model seats' windows
    Then it "warns that the window is unknown and proceeds"

  # BL-1801 the-override-turns-a-refusal-into-a-warning-04
  Scenario: the human override turns a refusal into a warning
    Given the fake Ollama reports num_ctx "4096" for the coder's model
    And the coder's composed first turn is 15000 characters and the recorded CLI overhead is 3000 characters
    And SWARMFORGE_LOCAL_WINDOW_OVERRIDE is 1
    When the launch checks the local-model seats' windows
    Then it "warns that the override let an over-window seat start, and proceeds"

  # BL-1801 a-pack-with-no-local-model-seat-checks-nothing-05
  Scenario: a pack with no local-model seat asks Ollama nothing
    Given a pack whose seats all run the "claude" agent
    When the launch checks the local-model seats' windows
    Then it "proceeds with no window message"
    And the fake Ollama received no request
