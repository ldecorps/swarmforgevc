Feature: the heal wrapper emits only parseable bash and round-trips hostile commands

  # BL-960 (epic tool-miss-auto-heal; defect against BL-913's shipped hook).
  # build-healing-wrapper-command (swarmforge/scripts/tool_miss_heal_lib.bb)
  # splices the original command as raw text into __sfh_out=$( ... 2>&1) --
  # unescaped, never parse-checked -- once for the first run and once per
  # miss-class clause. Any command that is valid bash on its own but cannot
  # survive textual embedding in $( ... ) (heredocs, literal parens) becomes
  # a syntax error, and the failure is silent-PARTIAL: part of the mangled
  # command may execute before the shell dies. Live cost 2026-08-19: QA
  # stalled 50 minutes, a heredoc-written file truncated at 776 bytes; the
  # operator disabled the hook (swarmforge.sh, 3bac496ec) until fixed.
  # Separately, the :missing-root-argv heal appends "$__sfh_root" to the end
  # of the WHOLE command string, so on a pipeline or ;-sequence the argument
  # lands on the final segment (observed live: echo "---done---" "$__sfh_root").
  #
  # Step handlers: specs/pipeline/steps/bl960HealWrapperParseSafetySteps.js,
  # generating wrappers via build-healing-wrapper-command / the hook path and
  # executing them under bash against fixture dirs (removed in a finally).
  # The <shape> column is validated against explicit KNOWN_VALUES.

  Background:
    Given a pinned worktree used by the Bash PreToolUse heal wrapper

  # BL-960 heal-wrapper-parse-safe-round-trip-01
  Scenario Outline: a hostile-but-valid command round-trips through the wrapper byte-exactly
    Given an original command of shape "<shape>" that is valid bash on its own
    When the PreToolUse heal wrapper is generated and executed for that command
    Then the wrapper source parses as bash
    And the wrapper's exit code, combined output, and file side effects are byte-identical to the unwrapped command's

    Examples:
      | shape               |
      | quoted-heredoc      |
      | literal-close-paren |
      | nested-quotes       |
      | pipeline            |
      | semicolon-sequence  |

  # BL-960 heal-wrapper-parse-safe-round-trip-02
  Scenario: an unparseable composition fail-opens to the untouched original, silently
    Given an original command whose composed wrapper does not parse as bash
    When the hook processes that command
    Then the hook returns the original command byte-untouched
    And the hook emits no narration about the failed composition

  # BL-960 heal-wrapper-parse-safe-round-trip-03
  Scenario: a real failure still passes through unchanged with no retry
    Given an original command that fails with output matching no miss class
    When the PreToolUse heal wrapper is generated and executed for that command
    Then the command's own output and exit code are returned unchanged
    And the command ran exactly once

  # BL-960 heal-wrapper-parse-safe-round-trip-04
  Scenario: a single simple command's missing-root-argv miss is still healed once
    Given an original command that misses because of "missing-root-argv" and is a single simple command
    When the role runs that command
    Then the command is re-run once with the pinned root supplied to that command

  # BL-960 heal-wrapper-parse-safe-round-trip-05
  Scenario: a missing-root-argv miss in a multi-command sequence is never misdirected
    Given an original command that is a multi-command sequence whose failing segment misses because of "missing-root-argv" and whose final segment is an unrelated command
    When the role runs that command
    Then the pinned root is never appended to the unrelated final segment

  # BL-960 heal-wrapper-parse-safe-round-trip-06
  Scenario: role launch settings register the Bash PreToolUse heal hook again
    Given launch settings are written for a role
    Then the settings file registers the tool-miss-heal hook for the Bash tool
