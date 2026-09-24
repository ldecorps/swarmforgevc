Feature: BL-1708 swarm stamp - aider seats see the served context window (hotfixes ab1d4cb2bd, d0dd4d36b7)

  Review-only certification (BL-848) of two operator hotfixes from
  2026-09-23, both live on main. ab1d4cb2bd makes every aider seat's
  launch line pass the repo-root model settings and metadata by absolute
  path (aider only looked in its own git root, the worktree, so only the
  coordinator ever read them) and record each seat's requests with
  --llm-history-file. d0dd4d36b7 serves qwen2.5-coder at its native 32k
  window through a per-model Modelfile and pins aider's repo map at 1024
  tokens in that pack's start script. These scenarios confirm what
  landed; they change nothing in it.

  # BL-1708 swarm-stamp-aider-seats-see-the-served-context-window-01
  Scenario Outline: every aider seat's launch line reads the repo-root settings and logs its requests
    When the launch script for the aider "<role>" seat is generated
    Then it passes the repo-root model settings and model metadata files by absolute path
    And it passes an llm history file for "<role>" under the swarm state directory

    Examples:
      | role        |
      | coder       |
      | QA          |
      | coordinator |

  # BL-1708 swarm-stamp-aider-seats-see-the-served-context-window-02
  Scenario: a Claude seat's launch line carries none of the aider settings flags
    When the launch script for a Claude seat is generated
    Then it carries no model settings file, no model metadata file and no llm history file

  # BL-1708 swarm-stamp-aider-seats-see-the-served-context-window-03
  Scenario: the qwen2.5-coder pack serves a 32k window per model and pins the repo map
    When the qwen2.5-coder Modelfile and the pack's start script are read
    Then the Modelfile sets num_ctx 32768 on the existing qwen2.5-coder tag
    And the start script sets AIDER_MAP_TOKENS to 1024 before it launches the swarm
