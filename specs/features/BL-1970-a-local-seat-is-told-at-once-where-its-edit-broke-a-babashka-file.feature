Feature: BL-1970 A local-model seat is told at once where its edit broke a Babashka file

  A small model cannot balance parentheses by counting them. On 2026-10-04
  the iq3 coder, working BL-1902, left one form in
  bl1360_ceremony_handoff_property_runner.bb unclosed, then spent more than
  twenty minutes and two compactions adding and removing a closing paren by
  hand. Babashka's reader had named the place all along ("EOF while
  reading, expected ) to match ( at [239,1]"), but only inside a stack trace
  printed by a later test run. A qwen PostToolUse hook, registered in every
  local-model seat's settings like the PreCompact hook (BL-1949), reads the
  file the seat just edited and hands the reader's message back in the same
  turn.

  Background:
    Given a local-model seat's edit hook and a fixture worktree

  # BL-1970 an-edit-that-breaks-a-babashka-file-names-the-open-form-01
  Scenario: an edit that leaves a Babashka file unreadable is answered with the open form's line and column
    Given a Babashka file whose form opened at line 3 column 1 is never closed
    When the hook runs for the seat's edit of that file
    Then the hook's additional context names the file and the reader message "expected ) to match ( at [3,1]"

  # BL-1970 an-edit-that-leaves-the-file-readable-adds-nothing-02
  Scenario: an edit that leaves a Babashka file readable adds no context
    Given a Babashka file that reads cleanly
    When the hook runs for the seat's edit of that file
    Then the hook adds no context

  # BL-1970 an-edit-of-a-file-that-is-not-lisp-adds-nothing-03
  Scenario: an edit of a file that is not Clojure source adds no context
    Given a Markdown file with an unmatched parenthesis
    When the hook runs for the seat's edit of that file
    Then the hook adds no context

  # BL-1970 every-local-seat-registers-the-edit-hook-04
  Scenario: every local-model seat's written settings register the edit hook from the master checkout
    When the launcher writes a local-model seat's qwen settings
    Then the settings register the master checkout's edit hook for qwen's edit and write_file tools
    And the provider entry merge keeps that registration
