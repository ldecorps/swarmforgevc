Feature: A BL topic record is a complete and durable transcript

# BL-348: the human reported "new topics are still created without a summary". Investigation
# showed the LIVE path is fine — every topic opened since the record store went live opens with
# a proper summary. Two real defects sit underneath the report instead. First, 26 older records
# have no opening summary at all: their first message is the ticket's COMPLETION, because the
# record file was born at close time. Second — and worse — 31 of 34 record files were never
# committed, because the record's own commit fails silently. A record that is neither complete
# nor in git cannot do the one job it exists for: rebuilding a topic from its own history.

Background:
  Given a BL topic record is the durable history of a ticket's topic

# BL-348 topic-records-complete-and-durable-01
Scenario: A record whose history starts at completion gains its missing opening summary
  Given a record whose first message is the ticket's completion
  When the records are repaired
  Then that record opens with a summary of what the ticket was

# BL-348 topic-records-complete-and-durable-02
Scenario: The restored opening summary is regenerated from the ticket's own spec
  Given a record missing its opening summary
  And the ticket it belongs to is closed
  When the records are repaired
  Then the restored summary says what the ticket was, what it solved, and how it worked
  And it matches what the summary would have said when the ticket opened

# BL-348 topic-records-complete-and-durable-03
Scenario: The restored summary is ordered before the completion it was missing from
  Given a record whose first message is the ticket's completion
  When the records are repaired
  Then the restored summary comes before the completion in that record's history

# BL-348 topic-records-complete-and-durable-04
Scenario: Repairing twice does not duplicate the summary
  Given the records have already been repaired
  When the records are repaired again
  Then no record gains a second opening summary

# BL-348 topic-records-complete-and-durable-05
Scenario: A record that already opens correctly is left untouched
  Given a record that already opens with its summary
  When the records are repaired
  Then that record is unchanged

# BL-348 topic-records-complete-and-durable-06
Scenario: A repaired record survives a fresh checkout
  Given a record that has been repaired
  When the repository is checked out fresh
  Then the repaired record and its restored summary are both in the fresh checkout

# BL-348 topic-records-complete-and-durable-07
Scenario: A record written during normal operation reaches the repository
  Given a ticket whose topic receives a message during normal operation
  When the message is recorded
  Then that record is committed to the repository

# BL-348 topic-records-complete-and-durable-08
Scenario: A record that cannot be committed is reported, never silently dropped
  Given a record whose commit cannot be made
  When the message is recorded
  Then the failure to commit it is surfaced
