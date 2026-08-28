Feature: an answered question reaches a role once, and an answer pointer names that answer

  # BL-1203 (epic swarm-reliability). Measured 2026-08-27 19:45 BST from
  # .swarmforge/handoffs/specifier/inbox/completed/: 41 notes carrying the
  # text "use staging" have reached the specifier. One is the 2026-08-01
  # original, sent by the hardender. The other 40 were all sent TODAY, by
  # the coordinator, from 11:52Z to 18:58Z, in roughly twenty bursts of the
  # identical four-message sequence — "use staging please", "answer ready:
  # <pointer>", "use staging", "answer ready: <pointer>" — each burst
  # spanning about four seconds. Identical content on a repeating cadence is
  # machine replay, never a human typing. The notes are sent by the
  # front-desk bot's enqueueRoleAnswerNote, which shells swarm_handoff.bb
  # under SWARMFORGE_ROLE=coordinator, so the coordinator's outbox is where
  # they appear and the coordinator agent is not the author.
  #
  # A discriminator the fix must account for, not assume away: the pointer
  # file .swarmforge/operator/role-answers/specifier.json was last written
  # 2026-08-22T18:01:36Z and holds an answer about archiving handoff trails
  # — unrelated to anything the notes announce. enqueueRoleAnswerNote writes
  # that file before composing the note, so a path that re-ran it today
  # would have refreshed the mtime. It did not. Whatever re-sent these notes
  # therefore did not come through that write, and the first acceptance step
  # is to establish what did.
  #
  # Cost so far, today alone: about eighty priority-00 notes into one role's
  # mailbox, several specifier turns spent triaging them, and a clarifying
  # question raised to the human on the false premise that he had repeated
  # the same directive twenty times.

  # BL-1203 an-answer-is-delivered-once-01
  Scenario: Re-processing an already-delivered answer enqueues no second note
    Given an inbound answer for a role has already been delivered as a note
    When the same inbound answer is processed again
    Then the role's inbox gains no further note for that answer

  # BL-1203 answer-pointer-names-the-announced-answer-02
  Scenario: A note that points at an answer file points at that answer
    Given a role answer too long to carry inline
    When the answer is delivered as a pointer note
    Then the file the note names holds that answer
