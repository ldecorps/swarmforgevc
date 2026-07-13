Feature: Reopening a deleted ticket's topic recreates it and rehydrates its context

# BL-332: slice 4 of archive-then-delete. Telegram's reopenForumTopic only works on a topic that
# STILL EXISTS — once deleted, the thread id is gone permanently. So "reopen" after deletion can
# only mean: create a FRESH topic and rehydrate it from the archive. That is fine, but it must be
# designed as such rather than discovered later.

Background:
  Given a ticket whose topic was archived and then deleted

# BL-332 reopen-rehydrate-01
Scenario: Re-promoting the ticket gives it a fresh topic
  When that ticket is put back into work
  Then a new topic is created for it
  And the swarm posts about that ticket in the new topic

# BL-332 reopen-rehydrate-02
Scenario: The fresh topic opens with the archived context
  When that ticket is put back into work
  Then the new topic's opening message carries the archived summary
  And it carries a pointer to the full transcript in the repository

# BL-332 reopen-rehydrate-03
Scenario: The archived transcript is not destroyed by reopening
  When that ticket is put back into work
  Then the archived transcript in the repository is left intact
