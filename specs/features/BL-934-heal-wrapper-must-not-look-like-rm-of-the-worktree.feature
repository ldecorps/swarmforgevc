Feature: a heal wrapper for rm of non-worktree paths does not look like rm of the worktree

  # BL-934 (epic tool-miss-auto-heal). BL-913's Bash PreToolUse hook rewrites
  # every command into a self-healing wrapper before Claude Code runs it.
  # The missing-root-argv heal is inlined as the original command with the
  # pinned worktree appended as a trailing argument. Claude Code classifies
  # that rewritten source, not the model's original, so:
  #
  #     rm -f tmp/foo.json '/Users/ldecorps/projects/swarmforgevc'
  #
  # is read as rm of the working directory. The live specifier pane then
  # prompts "Dangerous rm operation on working directory or its ancestor"
  # on every rm of a temp file, even with --dangerously-skip-permissions.
  # Yes approves only that one invocation, so it keeps asking.
  #
  # The classified source must not add the worktree as an extra argument to
  # the original command. The original command itself must stay visible as
  # a command, so a genuine rm of the worktree is still classifiable.
  #
  # Step handlers: specs/pipeline/steps/bl934HealWrapperRmFalsePositiveSteps.js,
  # inspecting build-healing-wrapper-command output (and, for the neighbour,
  # running it). The <miss> column is validated against explicit KNOWN_VALUES.

  Background:
    Given a pinned worktree used by the Bash PreToolUse heal wrapper

  # BL-934 heal-wrapper-must-not-look-like-rm-of-the-worktree-01
  Scenario: rm of a non-worktree path does not present the worktree as an extra argument
    Given an original command that removes a relative temp file
    When the PreToolUse heal wrapper is generated for that command
    Then the wrapper source does not present the pinned worktree as an extra argument to that command

  # BL-934 heal-wrapper-must-not-look-like-rm-of-the-worktree-02
  Scenario: a genuine rm of the worktree stays visible as a command
    Given an original command that removes the pinned worktree
    When the PreToolUse heal wrapper is generated for that command
    Then the original command still appears as a command in the wrapper source

  # BL-934 heal-wrapper-must-not-look-like-rm-of-the-worktree-03
  Scenario: a non-rm missing-root-argv miss is still healed once
    Given an original command that misses because of "missing-root-argv" and is not an rm
    When the role runs that command
    Then the command is re-run once from "the same place, with the project root supplied"
    And the model receives only the healed result
