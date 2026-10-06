Feature: BL-2039 The chase sweep never chases a seat over a parcel its tier refuses

  A multi-seat stage's shared queue lives in the mailbox of the seat whose
  id is the stage name. The chase sweep chases every aged item in a
  mailbox against that mailbox's owner, and never asks whether the owner
  may claim it. On 2026-10-06 the coder stage queue held a Work note for a
  medium ticket; its owner, the easy-tier seat coder, refuses medium
  tickets (BL-1001), so the note waited for the hard-tier seat coder@2.
  The sweep chased coder twenty times for it and respawned it twice in
  eighteen minutes while coder was working another ticket, and never woke
  coder@2. After this parcel the sweep reads the same claim decision the
  dispatcher reads: it leaves a seat alone over a parcel that seat may not
  claim, and it wakes an idle seat of the stage that may claim it instead.

  Background:
    Given a fixture root whose coder stage has an easy-tier seat coder and a hard-tier seat coder@2 on different models
    And a Work note for an active ticket in the coder stage queue, past the chase timeout and already chased three times
    And the coder seat's liveness reads unknown and its pane is quiet

  # BL-2039 an-ineligible-seat-is-never-respawned-or-dead-lettered-01
  Scenario: the easy seat is neither respawned nor dead-lettered over a medium ticket's parcel
    Given the ticket's mutation_cost is medium
    When the daemon's chase sweep runs once on the fixture root
    Then no respawn is triggered for coder
    And no wake is sent to coder
    And the Work note is still in the coder stage queue with no dead-letter marker

  # BL-2039 an-idle-eligible-seat-is-woken-02
  Scenario: an idle hard-tier seat is woken for a medium ticket's parcel
    Given the ticket's mutation_cost is medium
    And the coder@2 seat has nothing in progress
    When the daemon's chase sweep runs once on the fixture root
    Then a wake is sent to coder@2

  # BL-2039 an-eligible-owner-keeps-the-ladder-03
  Scenario: a low ticket's parcel keeps today's ladder on the easy seat
    Given the ticket's mutation_cost is low
    When the daemon's chase sweep runs once on the fixture root
    Then exactly one respawn is triggered for coder

  # BL-2039 an-unclaimable-parcel-still-alarms-04
  Scenario: a parcel no seat of the stage may claim is dead-lettered without a respawn
    Given the ticket's mutation_cost is high
    And the coder@2 seat is declared easy-tier too
    When the daemon's chase sweep runs once on the fixture root
    Then no respawn is triggered for coder
    And the Work note carries a dead-letter marker
