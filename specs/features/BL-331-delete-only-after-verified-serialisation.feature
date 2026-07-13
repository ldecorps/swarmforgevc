Feature: A done ticket's topic is archived into the repo and only then deleted

# BL-331: slice 3 of archive-then-delete. Telegram offers only close / reopen / delete for a
# forum topic — there is NO per-topic archive, and close only LOCKS a topic, leaving it visible.
# So the list grows without bound (21 closed topics beside 2 live ones). Deletion is the only
# way to remove one, and deletion destroys the history permanently. Archive-then-delete, and
# NEVER delete on an ATTEMPTED archive — only on a VERIFIED one.

Background:
  Given a completed ticket whose topic content has been serialised into the repository

# BL-331 archive-then-delete-01
Scenario: A topic is only deleted once its record is verified
  When the topic sweep considers that ticket
  Then its serialised record is verified complete in the repository
  And the record is verified before any deletion is attempted

# BL-331 archive-then-delete-02
Scenario: A failed or incomplete serialisation aborts the deletion and surfaces loudly
  Given the serialised record is missing or incomplete
  When the topic would be deleted
  Then the deletion does not happen
  And the failure is surfaced loudly
  And the topic and its record are left intact

# BL-331 archive-then-delete-03
Scenario: A deleted topic's mapping is dropped so nothing posts to a dead thread
  Given a ticket has been deleted after its record was verified
  When the swarm next has something to say about that ticket
  Then it does not post to the deleted thread
  And that ticket no longer maps to a topic

# BL-331 archive-then-delete-04
Scenario: Nothing is deleted inside the retention window
  Given a ticket completed within the retention window
  When the topic sweep runs
  Then that ticket's topic is not deleted

# BL-331 archive-then-delete-05
Scenario: A topic with no record is never deleted
  Given a completed ticket whose topic has no verified record
  When the topic sweep runs
  Then that ticket's topic is not deleted
