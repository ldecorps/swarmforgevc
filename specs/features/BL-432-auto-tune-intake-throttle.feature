Feature: The swarm auto-throttles its own intake when it diagnoses too much rework

# BL-432 (epic BL-429, slice 3 — ACT, the mandatory wiring slice). Promoted (BL-430 + BL-431 both
# landed): materialized verbatim from the human-approved .feature.draft companion (BL-233's own
# not-picked-up-while-.draft convention) now that its dependencies are satisfied.
#
# This is the slice that closes the observe -> diagnose -> act loop. It moves exactly ONE knob — the
# Article 3.5 intake throttle — as an effective cap = min(configured, recommended). Scenario 04 (never
# raise above configured) is the guard that keeps an auto-tuner from becoming its own suboptimality.
# Scenario 03 (restore on recovery) was retired 2026-10-05 (BL-1981, Article 3.5's amendment): a cleared
# signal no longer restores the cap by itself - it holds at the lowest cap the episode reached until a
# human releases it. BL-1981's own feature carries that coverage now.

Background:
  Given a configured active-depth cap and a rework diagnosis

# BL-432 auto-tune-intake-throttle-01
Scenario: A degraded rework diagnosis lowers the effective cap to one
  Given the rework diagnosis is degraded
  When the coordinator decides whether to promote the next item
  Then the effective active-depth cap is one

# BL-432 auto-tune-intake-throttle-02
Scenario: A severe rework diagnosis lowers the effective cap to zero
  Given the rework diagnosis is severe
  When the coordinator decides whether to promote the next item
  Then the effective active-depth cap is zero
  And no new item is promoted

# BL-432 auto-tune-intake-throttle-04
Scenario: The recommendation only ever lowers the cap, never raises it
  Given a rework diagnosis recommending a cap above the configured value
  When the coordinator decides whether to promote the next item
  Then the effective active-depth cap is the configured value

# BL-432 auto-tune-intake-throttle-05
Scenario: Every change to the effective cap is logged
  Given the rework diagnosis lowers the effective cap
  When the effective cap changes
  Then the change is written to the log with its reason

# BL-432 auto-tune-intake-throttle-06 (added by BL-1869, the refresh-before-diagnose hotfix)
Scenario: A degraded diagnosis left on disk does not lower the cap once the live window shows no rework
  Given a persisted rework diagnosis from an earlier run that reads degraded
  And no ticket closed in the live window was bounced
  When the coordinator decides whether to promote the next item
  Then the effective active-depth cap is the configured value
