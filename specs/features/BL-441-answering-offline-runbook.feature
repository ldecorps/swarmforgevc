Feature: A short "answering offline" runbook tells the human how to answer the swarm from a checkout

# BL-441 (docs): once the ANSWER-*.md offline return path (BL-440) exists, the human needs a short
# runbook covering where pending questions are READ offline and how to compose answers. Materialized
# from the .feature.draft companion when BL-440 landed and this ticket was promoted.
#
# Scope: a text-based runbook under docs/runbooks/ pointing at the read surface that already exists
# (git-committed BL topics / backlog/topics/*.json) and the ANSWER-*.md compose convention from BL-440.
# Note (verified in pwa/app.js): the static PWA dashboard fetches only backlog.json / docs-tree.json /
# recert-batch.json and does NOT surface pending questions, so the runbook points at the BL topics as
# the offline read surface and warns against relying on the PWA for this.

# BL-441 answering-offline-runbook-01
Scenario: The runbook explains composing an ANSWER-*.md that references an ask
  Given the "answering offline" runbook
  When the human reads it
  Then it explains composing an ANSWER-*.md at the backlog root that references a BL id, topic, or ask id

# BL-441 answering-offline-runbook-02
Scenario: The runbook points to where pending questions are read offline
  Given the "answering offline" runbook
  When the human reads it
  Then it points to the committed BL topics as the offline read surface and notes the PWA does not surface pending questions

# BL-441 answering-offline-runbook-03
Scenario: The runbook states the stale-premise behaviour
  Given the "answering offline" runbook
  When the human reads it
  Then it states that a late answer may be reported not-executed if the premise has moved on
