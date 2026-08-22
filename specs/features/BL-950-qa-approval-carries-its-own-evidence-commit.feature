# BL-806 refuses a review role's forward-direction git_handoff when it names
# exactly the commit that role received - Article 4.4's structural backstop,
# forcing a clean pass to commit its explicit-NONE inventory and forward THAT
# commit. Its approved scope covered the four forward-chain review roles only;
# QA's own send paths were excluded that slice.
#
# QA's approval to the coordinator is the last hop before a ticket closes, and
# it is the excluded one. These scenarios extend the same refusal to it, and
# pin the exclusions that must survive: a bounce, a merge-up note, a marked
# detour, and every shape where there is nothing to compare against.
Feature: A QA approval names the commit QA made, never the bare commit it received

  Background:
    Given the handoff gate reads the commit a role received for a task from that role's own in-process mailbox

  # BL-950 qa-approval-evidence-01
  Scenario: an approval that forwards the received commit is refused
    Given QA received the parcel for task "T" naming commit "aaaaaaaaaa"
    When QA sends an approval git_handoff to the coordinator naming commit "aaaaaaaaaa"
    Then the send is refused
    And the refusal names Article 4.4 pass evidence

  # BL-950 qa-approval-evidence-02
  Scenario: an approval that names QA's own evidence commit is delivered
    Given QA received the parcel for task "T" naming commit "aaaaaaaaaa"
    When QA sends an approval git_handoff to the coordinator naming commit "bbbbbbbbbb"
    Then the send is delivered

  # BL-950 qa-approval-evidence-03
  Scenario Outline: a QA send that is not an approval-forward passes untouched
    Given QA received the parcel for task "T" naming commit "aaaaaaaaaa"
    When QA sends <send> for task "T"
    Then the send is delivered

    Examples:
      | send                                                        |
      | a bounce git_handoff to the coder naming the same commit    |
      | a merge-up note to the worktree roles                       |
      | a git_handoff naming the same commit with a reroute_reason  |

  # BL-950 qa-approval-evidence-04
  Scenario: the gate fails open when there is no received commit to compare against
    Given QA holds no in-process parcel for task "T"
    When QA sends an approval git_handoff to the coordinator naming commit "aaaaaaaaaa"
    Then the send is delivered
