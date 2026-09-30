Feature: BL-1847 a deterministic coordinator's mail is relayed to the human and completed

  A pack that declares "config coordinator_mode deterministic" (BL-1846)
  has no model to read the prose notes roles send the coordinator: QA's
  approvals, the specifier's "ready in paused", a coder's "blocked", the
  daemon's own dropped-parcel nudges. Nothing may wait in that mailbox
  for a reader that does not exist, and nothing may be dropped. handoffd
  relays every parcel that arrives in the coordinator's new mail to the
  human's Telegram OPERATOR topic, one message per tick, then moves each
  parcel unchanged to the coordinator's completed mail, where the ticket
  close guard still reads QA's approval. A pack that declares no
  coordinator mode keeps today's mailbox untouched.

  Background:
    Given a scratch project with an empty coordinator mailbox

  # BL-1847 deterministic-coordinator-mail-01
  Scenario: a note to a deterministic coordinator is relayed and completed unchanged
    Given the pack declares the deterministic coordinator mode
    And a note from QA naming a ticket waits in the coordinator's new mail
    When handoffd runs its coordinator-mail sweep once
    Then that note is in the coordinator's completed mail byte for byte
    And one operator message names QA, that ticket and the note's first line

  # BL-1847 deterministic-coordinator-mail-02
  Scenario: several parcels in one tick reach the human as one message
    Given the pack declares the deterministic coordinator mode
    And three notes from three different roles wait in the coordinator's new mail
    When handoffd runs its coordinator-mail sweep once
    Then all three notes are in the coordinator's completed mail
    And exactly one operator message lists all three senders

  # BL-1847 deterministic-coordinator-mail-03
  Scenario: QA's relayed approval still satisfies the ticket close guard
    Given the pack declares the deterministic coordinator mode
    And QA's approval note for an active ticket waits in the coordinator's new mail
    When handoffd runs its coordinator-mail sweep once
    Then the ticket close guard finds QA's approval for that ticket

  # BL-1847 deterministic-coordinator-mail-04
  Scenario: a relay that cannot be written leaves the parcel in new mail
    Given the pack declares the deterministic coordinator mode
    And a note from QA naming a ticket waits in the coordinator's new mail
    And the operator outbox path cannot be written
    When handoffd runs its coordinator-mail sweep once
    Then that note is still in the coordinator's new mail

  # BL-1847 deterministic-coordinator-mail-05
  Scenario: a pack that declares no coordinator mode keeps its coordinator mail
    Given the pack declares no coordinator mode
    And a note from QA naming a ticket waits in the coordinator's new mail
    When handoffd runs its coordinator-mail sweep once
    Then that note is still in the coordinator's new mail
    And no operator message is written
