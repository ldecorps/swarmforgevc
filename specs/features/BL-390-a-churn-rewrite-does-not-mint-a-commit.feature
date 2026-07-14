Feature: A topic record that did not really change does not mint a commit

# BL-390: the amplifier that turned a redelivery bug into 209 commits on origin/main. The topic-record
# persister commits on every rewrite, and handoffd's push sweep then pushes each one. BL-389 stops the
# redelivery at source; this ticket makes the persister refuse to mint a commit for a rewrite that
# changes nothing, so NO future upstream bug can ever again convert itself into unbounded git history.
# Same shape as the earlier 6x "Cost & health sidecar for 2026-07-14" churn commits at 07:56-07:57 —
# so this is not a one-off, and the guard belongs in the persister, not in each of its callers.

Background:
  Given a ticket has a topic record

# BL-390 a-churn-rewrite-does-not-mint-a-commit-01
Scenario: Rewriting a record with identical content commits nothing
  Given the record is rewritten with exactly the content it already had
  When the swarm persists the record
  Then no commit is made

# BL-390 a-churn-rewrite-does-not-mint-a-commit-02
Scenario: A record that genuinely changed is still committed
  Given the record is rewritten with a message it did not have
  When the swarm persists the record
  Then the record is committed

# BL-390 a-churn-rewrite-does-not-mint-a-commit-03
Scenario: Nothing is pushed when nothing was committed
  Given the record is rewritten with exactly the content it already had
  When the swarm persists the record
  Then nothing is pushed to the remote
