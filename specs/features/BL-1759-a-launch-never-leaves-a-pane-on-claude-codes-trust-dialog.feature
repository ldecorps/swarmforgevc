Feature: BL-1759 A launch never leaves a pane blocked or dead on Claude Code's trust dialog

  Claude Code asks "Is this a project you created or one you trust?" the
  first time it runs in a directory, and --dangerously-skip-permissions
  does not skip it. On 2026-09-25 a first launch of gpu-bargain-hunter
  left its coordinator pane silently blocked on the dialog while status
  read UP, and its coder pane gone: the highlighted default, "No, exit",
  quit the process. Trust is inherited from a trusted ancestor. This
  host's ~/.claude.json trusts /home/carillon/swarmforgevc and none of its
  .worktrees paths, yet every role pane runs, and the target's coder
  respawned cleanly once its root was trusted. So the launch needs the
  target root trusted before any Claude pane starts. With this feature the
  launch checks that, read-only, and stops with the one step the human
  takes if not (ruling A, recommended; if the human rules otherwise, the
  specifier rewrites this feature and re-pends).

  # BL-1759 untrusted-root-stops-before-any-pane-01
  Scenario: a launch whose target root Claude Code does not trust starts no pane and says how to trust it
    Given a fixture pack with a claude seat and a Claude config that trusts neither the target root nor any ancestor
    When the launch runs
    Then no tmux session is created
    And it exits non-zero naming the target root and the step that trusts it

  # BL-1759 trusted-root-or-ancestor-launches-02
  Scenario Outline: a launch whose target root is trusted through <trusted path> proceeds as today
    Given a fixture pack with a claude seat and a Claude config that trusts <trusted path>
    When the launch runs
    Then the launch proceeds to create its sessions

    Examples:
      | trusted path               |
      | the target root            |
      | the target root's parent   |

  # BL-1759 no-claude-seat-no-check-03
  Scenario: a pack with no claude seat is never checked
    Given a fixture pack whose seats are all aider and a Claude config that trusts nothing
    When the launch runs
    Then the launch proceeds to create its sessions

  # BL-1759 unreadable-config-warns-04
  Scenario: a Claude config the check cannot parse warns loudly and does not block
    Given a fixture pack with a claude seat and a Claude config that is not valid JSON
    When the launch runs
    Then it prints a warning naming the Claude config
    And the launch proceeds to create its sessions

  # BL-1759 claude-config-is-never-written-05
  Scenario: the check never writes the Claude config
    Given a fixture pack with a claude seat and a Claude config that trusts neither the target root nor any ancestor
    When the launch runs
    Then the Claude config is byte-identical to before the launch
