Feature: Mono-router starvation hand fix, adopted under review

  On 2026-08-03 the mono-router starved itself with real work in flight:
  a directed rule_proposal was never actionable for rotation, a chase poke
  at a non-preferred role dropped the rotate instead of redirecting, and
  chase escalation stopped waking a dormant holder once the alert armed.
  These scenarios pin the hand fix that recovered the live swarm
  (backlog/evidence/hotfix-2026-08-03-mono-router-starvation.md). All of
  them are drivable offline against the real handoffd.bb,
  mono_router_lib.bb, and chase_sweep_lib.bb over temp fixtures — no live
  swarm required.

  Background:
    Given a mono-router pack whose home role is coder

  # BL-795 mono-router-starvation-hand-fix-01
  Scenario: A directed rule_proposal alone makes its role the preferred rotate target
    Given a rule_proposal parcel sits in the specifier's new inbox
    And no other role has actionable mail or held work
    When the daemon computes the preferred rotate target
    Then the preferred rotate target is the specifier

  # BL-795 mono-router-starvation-hand-fix-02
  Scenario: A fresh note alone stays non-actionable
    Given a note younger than the ageing threshold sits alone in the specifier's new inbox
    When the daemon computes the preferred rotate target
    Then no role is preferred

  # BL-795 mono-router-starvation-hand-fix-03
  Scenario: A held in_process claim outranks a directed rule_proposal
    Given the hardender holds an in_process git_handoff at priority 00
    And a rule_proposal at priority 50 sits in the specifier's new inbox
    When the daemon computes the preferred rotate target
    Then the preferred rotate target is the hardender

  # BL-795 mono-router-starvation-hand-fix-04
  Scenario: A chase poke at a non-preferred role redirects onto the preferred role
    Given the hardender holds an in_process git_handoff at priority 00
    And a rule_proposal parcel sits in the specifier's new inbox
    When the chase sweep pokes the specifier
    Then the resident rotate is redirected onto the hardender
    And the poke is not dropped as not-preferred

  # BL-795 mono-router-starvation-hand-fix-05
  Scenario: Chase escalation on stuck in_process work keeps attempting resume
    Given a role holds in_process work that has exhausted its chase nudges past the stuck timeout
    When the stuck sweep runs
    Then the escalation is recorded
    And a wake-up is still applied to the holding role
    And the nudge count advances
