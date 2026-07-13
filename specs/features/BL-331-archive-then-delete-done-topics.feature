Feature: A done ticket's topic is archived into the repo and only then deleted

# BL-331: slice 3 of archive-then-delete. Telegram offers only close / reopen / delete for a
# forum topic — there is NO per-topic archive, and close only LOCKS a topic, leaving it visible.
# So the list grows without bound (21 closed topics beside 2 live ones). Deletion is the only
# way to remove one, and deletion destroys the history permanently. Archive-then-delete, and
# NEVER delete on an ATTEMPTED archive — only on a VERIFIED one.

Background:
  Given a completed ticket whose topic holds a durable transcript

# BL-331 archive-then-delete-01
Scenario: A completed ticket's topic is exported into the repo before any deletion
  When the ticket's topic is archived
  Then its transcript is exported into the repository
  And the export is verified as written before any deletion is attempted

# BL-331 archive-then-delete-02
Scenario: A failed archive aborts the deletion and surfaces loudly
  Given the archive export fails to write
  When the topic would be deleted
  Then the deletion does not happen
  And the failure is surfaced loudly
  And the topic and its transcript are left intact

# BL-331 archive-then-delete-03
Scenario: A deleted topic's mapping is dropped so nothing posts to a dead thread
  Given a ticket's topic has been archived and deleted
  When the swarm next has something to say about that ticket
  Then it does not post to the deleted thread
  And that ticket no longer maps to a topic

# BL-331 archive-then-delete-04
Scenario: Nothing is deleted inside the retention window
  Given a ticket completed within the retention window
  When the topic sweep runs
  Then that ticket's topic is not deleted

# BL-331 archive-then-delete-05
Scenario: A topic that was never archived is never deleted
  Given a completed ticket whose topic has no verified archive
  When the topic sweep runs
  Then that ticket's topic is not deleted
