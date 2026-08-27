Feature: A ticket's topic lifecycle is reconciled from state, not only from a transition

# BL-330: slice 2 of archive-then-delete. diffTaskCompleted compares a previous snapshot with
# the current one (swarmEventStream.ts:58), so a ticket that flips to done while the bot is
# down, crash-looping, or running a stale build has its transition MISSED PERMANENTLY — there
# is no catch-up pass. BL-328 proves this happened: the bot ran a 25-hour-stale build. For
# close-only that leaves a stray open topic. For archive-then-delete it is far worse: a missed
# completion means a topic that was never archived, and a later sweep that deletes it would
# destroy an un-archived transcript. This must land before ANY deletion path.

Background:
  Given the swarm posts to a Telegram topic for each backlog ticket

# BL-330 topic-reconciliation-01
Scenario: A completion that happened while the bot was down is still reconciled
  Given a ticket became done while the bot was not running
  When the bot reconciles the topic lifecycle
  Then that ticket's topic is brought to its completed state
  And the completion is not lost

# BL-330 topic-reconciliation-02
Scenario: Reconciliation is driven by current state, not by a transition it must have witnessed
  Given a ticket is done and its topic is not yet in its completed state
  When the bot reconciles the topic lifecycle
  Then that ticket's topic is brought to its completed state

# BL-330 topic-reconciliation-03
Scenario: Reconciliation is idempotent
  Given a done ticket whose topic is already in its completed state
  When the bot reconciles the topic lifecycle
  Then the topic is left as it is
  And it is not posted to or closed a second time

# BL-330 topic-reconciliation-04
Scenario: A ticket that is not done is left alone
  Given a ticket that is still in flight
  When the bot reconciles the topic lifecycle
  Then that ticket's topic is left open
