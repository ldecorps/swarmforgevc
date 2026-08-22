Feature: every pane title the launcher can produce is recognized as chrome

  tmux paints the session name into a box-drawing rule at the top of each pane
  ("──── SwarmForge Coder ──"). needsHumanDetection strips that rule line before
  it shows a captured question to a human, because letters in it defeat the
  whole-line box test. isPaneTitleRuleLine does the stripping, and it decides
  by matching the de-boxed text against PANE_TITLE_SESSION_NAME_PATTERN,
  /^SwarmForge [A-Za-z][\w-]*$/ — a single token of word characters.

  The titles are built by swarmforge.sh, which composes them as
  "SwarmForge ${DISPLAY_NAMES[$i]}" and fills DISPLAY_NAMES from
  display_name_for_role. That function rewrites '-' and '_' to spaces and
  title-cases each resulting word, so it emits names the pattern cannot match:
  'model-steward' becomes "Model Steward" and 'coder_extra' becomes
  "Coder Extra" — both multi-word, and \w excludes the space. A seat name is
  worse still: '@' is not in the rewrite set and not in \w, so 'coder@sonnet2'
  becomes "Coder@Sonnet2" and misses too. Run against the six role names this
  repo has actually configured, the shipped pattern matches two and misses four.

  The seat form is not hypothetical. This repo's own pack ran
  `window coder@sonnet2 ...` until the seat was removed on 2026-08-21, and the
  seat pool still names coder@extra, hardender@zz9 and cleaner@b. Whenever such
  a seat is live, its pane-title rule survives the chrome filter and is handed
  to a human as if it were part of the agent's question.

  This is the leak class BL-642 set out to close, left open for every role name
  outside a single [A-Za-z][\w-]* token. The set of names to recognize is not a
  matter of taste: it is exactly what display_name_for_role can emit, so a
  hand-extended character list is the wrong shape of fix and will drift again
  the first time the launcher learns a new separator.

  Background:
    Given a captured pane awaiting a needs-human decision

  # BL-732 pane-title-chrome-01
  Scenario Outline: the pane-title rule for a configurable role is dropped
    Given the launcher configures a role named "<role>"
    And the pane's first line is that role's box-drawing pane-title rule
    When the captured text is filtered for needs-human display
    Then the pane-title rule line is dropped as chrome

    Examples:
      | role          |
      | coder         |
      | QA            |
      | model-steward |
      | coder_extra   |
      | coder@sonnet2 |
      | hardender@zz9 |

  # BL-732 pane-title-chrome-02
  Scenario: a box-rule line carrying real text is kept
    Given the pane's first line is a box-drawing rule reading "Waiting for your answer"
    When the captured text is filtered for needs-human display
    Then that line is kept in the captured question text

  # BL-732 pane-title-chrome-03
  Scenario: a pane of nothing but chrome still fails closed
    Given every captured line is chrome, including a "coder@sonnet2" pane-title rule
    When the captured text is filtered for needs-human display
    Then the captured question text is the no-question-captured placeholder
