Feature: the tmux-reaper guard scopes by hazard, not by a token

  BL-817's guard keeps every step handler that starts a fixture tmux server
  wired to the shared fixtureReaper, so a mutant that fails early cannot leave
  a server running. It decides scope with STARTS_TMUX_SERVER,
  /['"]new-session['"]/, and its own comment explains the quoting: it is there
  so prose and URLs never false-positive, because "every real tmux-server
  starter in this repo passes 'new-session' as its own argv array element".

  The converse is never checked, and it is where the guard breaks. A file that
  ASSERTS ABOUT tmux argv also writes 'new-session' as a quoted argv element —
  because it is comparing against argv. That is not an exotic shape; it is
  what a test for "which tmux commands may this repair resolve to?" looks
  like.

  bl1018SingleRoleRepairNeverKillsServerSteps.js is exactly that test, and it
  is flagged. Its header says "Nothing here runs tmux, and that is the design,
  not a shortcut". It spawns one binary, `bb -e <expr>`, to evaluate resolved
  command vectors as data, then filters them for 'new-session' and asserts no
  command is a kill-server. It starts no server. It is red because it is
  correct, and the two ways to turn it green today are to add a reaper call
  that guards nothing or to obfuscate the string.

  The coercion has already reached the corpus. bl958ControlPlaneLossSteps.js
  writes a FAKE tmux at bin/tmux via a PATH stub, and its reap() call carries
  the comment "Required by extension/test/tmuxReaperGuard.test.js." — adopted
  for the gate at least as much as for the hazard. That file is also why the
  obvious fix is wrong: keying on a literal spawn call naming tmux exempts
  bl958 too.

  Background:
    Given the tmux-reaper guard scanning the step-handler tree

  # BL-1032 tmux-reaper-scope-01
  Scenario: a file that only asserts about tmux argv is not in scope
    Given a step file that evaluates resolved tmux commands as data and asserts about them
    And that file starts no tmux server
    And that file adopts no reaper
    When the guard scans it
    Then the guard reports no violation for that file

  # BL-1032 tmux-reaper-scope-02
  Scenario Outline: a file that can cause tmux to run stays in scope
    Given a step file that reaches a tmux server <by>
    And that file adopts no reaper
    When the guard scans it
    Then the guard reports a violation for that file

    Examples:
      | by                                  |
      | by spawning tmux directly           |
      | through a tmux stub it puts on PATH |

  # BL-1032 tmux-reaper-scope-03
  Scenario: the real step-handler tree is clean
    Given the step handlers as committed
    When the guard scans the whole tree
    Then the guard reports no violations
    And no step file adopts the reaper without starting a tmux server
