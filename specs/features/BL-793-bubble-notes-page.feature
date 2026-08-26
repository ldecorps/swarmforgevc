Feature: Bubble's expanded panel gains a Notes page one swipe from Let's Talk
  Expanding the Bubble today lands on Let's Talk and nothing else. This slice
  makes the expanded panel a two-page pager: Let's Talk stays the page it opens
  on, and one swipe reveals a Notes page that composes a short note to any
  declared swarm role through the bridge send path. Managing notes already
  queued — amend and withdraw — is a later slice.
  Source: backlog/INTAKE-bubble-send-notes-swipe-screen.md, human decisions
  locked 2026-07-31.

  Background:
    Given Bubble is paired with a reachable bridge

  # GH-29 bubble-notes-page-01
  Scenario: the expanded Bubble opens on Let's Talk
    When the human expands the Bubble
    Then the Let's Talk page is shown

  # GH-29 bubble-notes-page-02
  Scenario: the Notes page is one swipe away, and one swipe back
    Given the human has expanded the Bubble
    When the human swipes to the next page
    Then the Notes page is shown
    And the pager indicator marks the Notes page as current
    And swiping back shows the Let's Talk page

  # GH-29 bubble-notes-page-03
  Scenario: every declared role can be picked, dormant or not
    Given the human has opened the Notes page
    When the human opens the role picker
    Then every role the swarm declares is offered
    And a role with no running session is offered like any other

  # GH-29 bubble-notes-page-04
  Scenario: sending clears the box, keeps the role, and confirms
    Given the human has opened the Notes page
    When the human picks a role and sends a short note
    Then the note is queued for that role
    And the text box is cleared
    And the same role remains selected
    And a brief confirmation names the role the note went to

  # GH-29 bubble-notes-page-05
  Scenario Outline: a message the note format cannot carry is refused on the device
    Given the human has opened the Notes page
    When the human enters <message>
    Then the Notes page refuses to send it
    And the Notes page states <reason>
    And no note is queued

    Examples:
      | message                                | reason                       |
      | a message longer than the stated limit | the one-line character limit |
      | a message containing a line break      | the single-line requirement  |
      | an empty message                       | that a note needs a message  |

  # GH-29 bubble-notes-page-06
  Scenario Outline: a send the bridge refuses shows the reason the server gave
    Given the human has opened the Notes page
    When a send fails with <failure>
    Then the Notes page shows the reason for <failure>
    And the Notes page does not show a bare HTTP status code alone
    And the Notes page does not report the note as queued

    Examples:
      | failure               |
      | an unreachable host   |
      | a rejected token      |
      | a refused queue write |

  # GH-29 bubble-notes-page-07
  Scenario Outline: this slice sends only
    Given the human has opened the Notes page
    Then no <control> control is offered on the Notes page

    Examples:
      | control  |
      | amend    |
      | withdraw |
