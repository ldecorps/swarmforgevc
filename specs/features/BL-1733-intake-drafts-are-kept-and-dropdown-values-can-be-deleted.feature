Feature: BL-1733 Intake drafts are kept, and dropdown values can be deleted

  BL-1732's form files one intake at a time. The human also works on
  several drafts at once, comes back to them later and throws some away,
  and removes vocabulary values they do not want (their words: "I want to
  be able to delete what I dont want from dropdown lists."). Drafts are
  kept by the bridge host, never in the page's browser storage. A value
  added to a draft that is discarded never reaches the shared list. A
  deleted value is gone from later drafts, but nothing that already uses
  it is rewritten.

  # BL-1733 drafts-are-kept-and-resumed-01
  Scenario: two drafts are kept and each resumes where I left it
    Given a draft whose actor is "the human" and another whose actor is "the operator"
    When I reopen the form
    Then both drafts are listed
    And resuming the second shows the actor "the operator"

  # BL-1733 a-discarded-drafts-values-never-join-the-list-02
  Scenario: a value added to a discarded draft never joins the list
    Given I add the actor "a night-shift reviewer" to a draft
    When I discard that draft
    Then the draft is no longer listed
    And a new draft's actor dropdown does not offer "a night-shift reviewer"

  # BL-1733 a-confirmed-delete-removes-the-value-03
  Scenario: a confirmed delete removes the value from later drafts
    When I delete "a phone user" from the actor dropdown and confirm
    Then a new draft's actor dropdown does not offer "a phone user"

  # BL-1733 an-unconfirmed-delete-changes-nothing-04
  Scenario: a delete I cancel changes nothing
    When I delete "a phone user" from the actor dropdown and cancel
    Then a new draft's actor dropdown offers "a phone user"

  # BL-1733 a-delete-never-rewrites-what-uses-the-value-05
  Scenario Outline: deleting a value never rewrites what already uses it
    Given <holder> whose actor is "a phone user"
    When I delete "a phone user" from the actor dropdown and confirm
    Then <holder> still has the actor "a phone user"

    Examples:
      | holder             |
      | a submitted intake |
      | an open draft      |
