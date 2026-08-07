Feature: BL-848 hotfix swarm certification recurring check
  Operator and hand hotfixes must be inventoriable, recurrently checked for
  certification, and blessed as an official swarm deal only after a human ask.

  # BL-848 hotfix-cert-01
  Scenario: an operator hotfix is inventoriable by a durable signal
    Given a hotfix landed outside the normal pipeline and is present in the tree
    When the hotfix certification inventory is read
    Then the hotfix appears under a durable greppable signal
    And the signal is not only a chat message or briefing aside

  # BL-848 hotfix-cert-02
  Scenario: recurrent check surfaces an uncertified hotfix
    Given a hotfix is inventoriable and has no completed swarm stamp-off
    When the recurrent certification check runs on its configured existing loop
    Then the check reports the hotfix as uncertified
    And the finding remains until stamp-off completes or the human closes the ask

  # BL-848 hotfix-cert-03
  Scenario: official deal asks the human first
    Given a stamp-off review for a hotfix is ready to mark certified
    When the swarm would close the sibling as satisfied-by-hotfix or record the lasting blessing
    Then a human ask is raised on the Approvals or Concierge path first
    And the official deal is not recorded from green tests alone

  # BL-848 hotfix-cert-04
  Scenario: open stamp debt is visible to the check
    Given the Darwin orphan-janitor and Bubble reply-volume stamp intakes (or their minted review tickets) exist as uncertified debt
    When the recurrent certification check runs
    Then each of those hotfixes is named in the uncertified finding set
