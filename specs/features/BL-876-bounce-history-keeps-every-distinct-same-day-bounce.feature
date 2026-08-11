Feature: A ticket's own bounce record keeps every distinct same-day bounce

  The ticket YAML's bounce_history is the only instrument the lifecycle
  ledger reads for bounce events, so a bounce it collapses is lost to every
  consumer even though the JSONL bounce store still holds it. Two bounces
  the store keeps apart must stay apart here too, and only a bounce
  identical in every field is still folded away.

  Background:
    Given a bounce recorded against the ticket on 2026-08-07 for failure class "behavior" by "architect" citing commit "a6f61c2895"

  # BL-876 bounce-history-same-day-rebounce-01
  Scenario Outline: A same-day same-class bounce is kept unless it is identical
    When a bounce is recorded on 2026-08-07 for failure class "behavior" by "<by>" citing commit "<commit>"
    Then the ticket's own record carries a bounce history of size <size>, oldest first
    And the ticket's own record carries a bounce count of <size>

    Examples:
      | by        | commit     | size |
      | architect | ac7174a19c | 2    |
      | QA        | a6f61c2895 | 2    |
      | QA        | 8ac82a0e00 | 2    |
      | architect | a6f61c2895 | 1    |

  # BL-876 bounce-history-same-day-rebounce-02
  Scenario: A third distinct bounce on the same day and class is appended too
    Given a bounce recorded against the ticket on 2026-08-07 for failure class "behavior" by "QA" citing commit "8ac82a0e00"
    When a bounce is recorded on 2026-08-07 for failure class "behavior" by "hardender" citing commit "ac7174a19c"
    Then the ticket's own record carries a bounce history of size 3, oldest first
    And the ticket's own record carries a bounce count of 3
