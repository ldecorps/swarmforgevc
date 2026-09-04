# mutation-stamp: sha256=12e1c50e266d4a14a8fd08edaa32fc4e19d5eaaae7db88801becac53dee8e6e1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T13:25:14.974521783Z","feature_name":"A ceremony handoff is composed, not retyped","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1360-a-ceremony-handoff-is-composed-not-retyped.feature","background_hash":"3636d7d1a1397a05fff1b99eba015f0b160864232e238a4affd72167ebbc3baf","implementation_hash":"unknown","scenarios":[{"index":4,"name":"each defined ceremony carries the facts its recipient acts on","scenario_hash":"a32830ebda4e15b14b39ce7d62b440ec146de7bcfc2ebcbd34870cb4ede28827","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-03T13:25:14.974521783Z"}]}
# acceptance-mutation-manifest-end

Feature: A ceremony handoff is composed, not retyped

  Several pipeline handoffs carry no judgement at all. The QA merge-up
  broadcast has a fixed recipient list, a fixed priority and a fixed message
  template; only the ticket id and the approved commit vary. The QA-to-
  coordinator bookkeeping note and the specifier's spec-ready note are the
  same shape.

  Today each of those is hand-assembled: the role writes a draft file by hand,
  re-reads handoff-protocol.md to confirm the recipient list and whether `to:`
  takes a comma-separated list, and counts the message with `echo -n ... | wc
  -c` against the 80-character cap before daring to send. Observed 2026-09-03:
  one QA seat spent 16m06s and 58.6k tokens on exactly that, for two notes
  whose every field except two was already fixed by the protocol.

  The remedy is to compose those sends from one definition instead of retyping
  them. What the composer must NOT become is a second way into a mailbox: it
  is a front end to `swarm_handoff.sh`, so every send-time gate still arms and
  the tmux wake still fires.

  Background:
    Given a role is sending a named pipeline ceremony

  # BL-1360 a-ceremony-handoff-is-composed-not-retyped-01
  Scenario: the merge-up broadcast is composed from one recipient definition
    Given QA has an approved commit for a ticket
    When the merge-up ceremony is composed
    Then every pipeline worktree role is a recipient
    And the specifier is not a recipient
    And the ceremony is sent at priority 00

  # BL-1360 a-ceremony-handoff-is-composed-not-retyped-02
  Scenario: a composed message fits the note cap by construction
    Given QA has an approved commit for a ticket
    When the merge-up ceremony is composed
    Then the message is a single line of at most 80 characters
    And the message names the ticket and the commit in full

  # BL-1360 a-ceremony-handoff-is-composed-not-retyped-03
  Scenario: composing never bypasses a send-time gate
    Given a ceremony whose draft the send-time gates would refuse
    When the role sends the ceremony
    Then the refusal is reported to the sender unchanged
    And no mailbox receives the ceremony

  # BL-1360 a-ceremony-handoff-is-composed-not-retyped-04
  Scenario: an unknown ceremony name is refused rather than guessed
    Given a ceremony name the composer does not define
    When the role sends the ceremony
    Then the send is refused naming the ceremonies that are defined
    And no mailbox receives the ceremony

  # BL-1360 a-ceremony-handoff-is-composed-not-retyped-05
  Scenario Outline: each defined ceremony carries the facts its recipient acts on
    Given QA has an approved commit for a ticket
    When the <ceremony> ceremony is composed
    Then the message names the ticket and the commit in full

    Examples:
      | ceremony  |
      | merge-up  |
      | bookkeep  |
