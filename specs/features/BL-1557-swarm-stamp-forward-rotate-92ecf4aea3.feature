Feature: BL-1557 Stamp-off review of the resident-follows-its-forward hotfix

  BL-848 review-only certification of landed commit 92ecf4aea3 (2026-09-13).
  Human ruling 2026-09-13: "the default should be that the pipeline seats
  rotate where they push the parcel." Before it, a non-home mono-router role
  whose mailbox emptied after a git_handoff printed ROTATE_HOME and hopped to
  rotation_home (BL-550); the chase sweep carried the resident on to the
  recipient one to twenty minutes later - two respawns per stage, and a
  freshly promoted coder ticket could jump ahead of the current ticket's
  downstream stages. The hotfix has the task and batch dispatchers name the
  forward recipient (ROTATE_TO under the unchanged ROTATE_HOME line) and the
  wrapper rotate straight there, falling back to home on every unconfirmed
  path: no forward sent, recipient unknown or the coordinator, recipient is
  home, recipient no longer holds the parcel, or policy home.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  Background:
    Given a rotation-router pack whose home role is coder and whose roles.tsv names specifier, coder, cleaner, architect, hardender, documenter, QA and coordinator

  # BL-1557 swarm-stamp-forward-rotate-01
  Scenario Outline: the forward-rotate decision names the recipient only for a confirmed forward
    Given the departing role documenter, whose newest own git_handoff went to <recipient> and is <delivery>, under policy <policy>
    When the forward-rotate target is decided
    Then the target is <target> for reason <reason>

    Examples:
      | recipient   | delivery                            | policy    | target    | reason                        |
      | architect   | delivered and held by the recipient | recipient | architect | forward-recipient             |
      | architect   | still in the sender's outbox        | recipient | architect | forward-recipient-undelivered |
      | architect   | delivered and already consumed      | recipient | coder     | recipient-not-holding         |
      | architect   | delivered and held by the recipient | home      | coder     | policy-home                   |
      | coder       | delivered and held by the recipient | recipient | coder     | recipient-is-home             |
      | coordinator | delivered and held by the recipient | recipient | coder     | no-recipient                  |
      | reviewer    | delivered and held by the recipient | recipient | coder     | no-recipient                  |
      | nobody      | never sent                          | recipient | coder     | no-recipient                  |

  # BL-1557 swarm-stamp-forward-rotate-02
  Scenario: the real dispatchers and wrapper carry the decision and the hotfix's own case census is complete
    When the rotate-home shell test runs against the real ready_for_next dispatchers and wrapper
    Then it reports every check passed
    And its passing checks include cases 10 through 15, the six the hotfix added

  # BL-1557 swarm-stamp-forward-rotate-03
  Scenario: a master-resident role resolves only its own role-keyed sent box and never adopts a neighbour's forward
    Given the specifier and coordinator rows share one master checkout, the coordinator's git_handoff to architect sits in the coordinator's role-keyed sent box, a stray git_handoff to architect sits in the checkout's flat sent box, and architect holds both
    When the specifier's task dispatcher finds its mailbox empty
    Then it prints ROTATE_TO coder for reason no-recipient
    And every mailbox file on the shared checkout is unchanged

  # BL-1557 swarm-stamp-forward-rotate-04
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
