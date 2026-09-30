Feature: BL-1829 A local-model seat starts qwen with only the tools its role loop uses
  BL-1801's window gate estimates a local-model seat's first turn as the
  composed card plus the qwen CLI's own overhead. Measured on qwen 0.22.2,
  that overhead is about 105,000 characters, 28 tool definitions and the
  CLI's system prompt, which alone exceeds a 32768-token window, so every
  local-model seat on such a model is refused at launch. A seat needs six
  of those tools to run its loop: the shell, reading, writing and editing
  files, and finding them. Each local-model seat now carries its own qwen
  settings in its working directory that allow only those six, which
  brings the overhead to about 52,000-55,000 characters, and the gate's
  recorded overhead follows the new measurement. The operator's own qwen
  settings are never touched.

  Background:
    Given a pack with a local-model coder seat and a claude cleaner seat

  # BL-1829 seat-settings-name-only-loop-tools-01
  Scenario: the local-model seat's working directory carries qwen settings allowing only the loop's six tools
    When the launch scripts are written
    Then the coder seat's working directory has a .qwen/settings.json whose core tools are exactly run_shell_command, read_file, write_file, edit, glob and grep_search
    And its excluded tools name none of those six

  # BL-1829 other-agents-get-no-qwen-settings-02
  Scenario: a seat of another agent gets no qwen settings
    When the launch scripts are written
    Then the cleaner seat's working directory has no .qwen/settings.json written by the launch

  # BL-1829 a-32k-coder-seat-launches-03
  Scenario: a local-model coder seat with its compact card is not refused on a 32768-token window
    Given the swarm's recorded local-model CLI overhead and the coder's compact card
    When the window gate checks the coder seat against a 32768-token window
    Then the seat is not refused
