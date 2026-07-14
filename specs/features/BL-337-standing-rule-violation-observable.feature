Feature: A standing rule that is being violated shows up, instead of rotting quietly

# BL-337: the human asked how many times BL-252 and BL-255 have been violated since they landed,
# and asked for that count to become an observable on the daily email. The general point is the
# valuable one: a gate whose violation count is never surfaced is indistinguishable from a gate
# that is never triggered. Counts are derived from history (bounces, evidence commits,
# rule_proposals) rather than from new bookkeeping — because the question is about the past.

Background:
  Given a standing engineering rule that landed at a known point in history

# BL-337 standing-rule-violation-observable-01
Scenario: A standing rule's violations since it landed are counted from history
  Given the rule has been violated since it landed
  When the violations are counted
  Then the count reflects the violations that occurred after the rule landed

# BL-337 standing-rule-violation-observable-02
Scenario: Violations that predate the rule are not counted against it
  Given the rule was breached before it landed
  When the violations are counted
  Then that breach is not counted

# BL-337 standing-rule-violation-observable-03
Scenario: A rule added later is counted with no code change
  Given a new standing rule is added
  And the new rule has been violated
  When the violations are counted
  Then the new rule's violations are counted
  And no change was made to the counting mechanism

# BL-337 standing-rule-violation-observable-04
Scenario: A violation that is known to have happened is detected by the mechanism
  Given a violation of the rule that is known to have occurred
  When the violations are counted
  Then that violation is among them

# BL-337 standing-rule-violation-observable-05
Scenario: A rule with no violations is reported as holding, not omitted
  Given the rule has never been violated
  When the violations are counted
  Then the rule is reported with a count of zero

# BL-337 standing-rule-violation-observable-06
Scenario: The violation count appears on the briefing the human receives
  Given the rule has been violated since it landed
  When the briefing is produced
  Then the briefing carries the rule's violation count
