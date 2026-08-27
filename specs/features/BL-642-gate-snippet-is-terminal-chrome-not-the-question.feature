Feature: a gated role's Telegram snippet shows the question, or honestly says it captured none

  # BL-642: extractQuestionSnippet's chrome filter is deliberately conservative
  # (BL-395: drop a line only when unambiguously chrome), so two word-bearing
  # furniture lines slip through on the live coder pane — the tmux pane-title
  # rule ("──── SwarmForge Coder ──") and a width-truncated status footer
  # ("⏵⏵ bypass permissions on ... e…"). The fix anchors on the exact known
  # shapes (session-name title rule; footer's START, since the terminal only
  # ever truncates the END) and, when nothing survives, sends an explicit
  # "(no question text captured; open the pane)" message instead of furniture.

  # BL-642 live-capture-strips-all-known-chrome-01
  Scenario: the reproduced live capture yields no furniture
    Given the live coder pane capture from source:
    When extractQuestionSnippet runs on it
    Then the result contains none of the pane title rule, the footer, or a bare "/rc"

  # BL-642 real-question-with-chrome-like-words-survives-02
  Scenario: a real question containing "permissions" or box-drawing characters is returned unchanged
    Given a pane capture whose question line contains the word "permissions"
    And another pane capture whose question line contains box-drawing characters
    When extractQuestionSnippet runs on each
    Then each result is the question text, unchanged

  # BL-642 no-question-text-yields-explicit-message-03
  Scenario: a capture with no question text yields the explicit "nothing captured" message
    Given a pane capture containing only chrome and no question text
    When extractQuestionSnippet runs on it
    Then the result is "(no question text captured; open the pane)"
    And the result is neither a furniture string nor an empty body

  # BL-642 truncated-footer-recognised-at-several-widths-04
  Scenario Outline: a footer truncated at different terminal widths is still recognised as chrome
    Given a footer string cut to "<width>" characters
    When extractQuestionSnippet runs on a pane capture ending in that truncated footer
    Then the truncated footer is absent from the result

    Examples:
      | width |
      | 40    |
      | 60    |
      | 80    |

  # BL-642 detectNeedsHuman-unchanged-05
  Scenario: detectNeedsHuman's gate decision is unaffected by the snippet fix
    Given the live coder pane capture from source:
    When detectNeedsHuman runs on it
    Then it returns false, unchanged from before this fix
