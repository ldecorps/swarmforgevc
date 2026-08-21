Feature: Pipeline board caption and cap hotfix

  The Telegram pipeline board's grid caption lines identify each ticket by
  its own title rather than by its epic, and the two below-grid lists are
  capped short enough to read on a phone. Every cap announces what it
  dropped, every caption identifies something, and the whole message still
  fits inside a single Telegram send.

  Background:
    Given a pipeline board rendered from the backlog folders and the role-held tickets

  # BL-956 pipeline-board-caption-and-cap-01
  Scenario: A grid caption identifies its ticket by title, not by epic
    Given active ticket "BL-1" holds epic "concerto" and title "Front desk reads photo captions"
    When the board is rendered
    Then the caption line for "BL-1" reads "1 Front desk reads photo captions"
    And no caption line reads "1 concerto"

  # BL-956 pipeline-board-caption-and-cap-02
  Scenario: A grid row with no backlog entry still identifies itself
    Given role "coder" holds ticket "BL-2" and no backlog entry exists for it
    When the board is rendered
    Then the caption line for "BL-2" carries text after the ticket id

  # BL-956 pipeline-board-caption-and-cap-03
  Scenario: Caption lines are separated into groups where the epic changes
    Given active tickets "BL-1" and "BL-2" hold epic "concerto" and active ticket "BL-3" holds epic "fugue"
    When the board is rendered
    Then the caption lines for "BL-1" and "BL-2" are adjacent
    And a blank line separates the caption lines for "BL-2" and "BL-3"

  # BL-956 pipeline-board-caption-and-cap-04
  Scenario Outline: A below-grid list shows at most three entries and names the rest
    Given "<count>" parked tickets of kind "<kind>" awaiting the board
    When the board is rendered
    Then "3" entries of kind "<kind>" are listed
    And a line reads "<overflow>"

    Examples:
      | kind          | count | overflow            |
      | plain-parked  | 5     | +2 more parked      |
      | epic-tracker  | 5     | +2 more epics       |

  # BL-956 pipeline-board-caption-and-cap-05
  Scenario: A board of long-titled tickets still fits one Telegram send
    Given every active ticket carries a title of "180" characters
    When the board is composed for sending
    Then the composed message is within the board message length limit
    And every visible ticket is still identified on the board
