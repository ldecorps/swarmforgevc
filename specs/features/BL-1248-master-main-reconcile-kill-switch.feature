Feature: BL-1248 the master-main-reconcile sweep can be switched off from config, and is off until BL-1236 lands

  The reconcile sweep decides whether to absorb origin into local main, and
  BL-1236 pins its conflict predicate as broken: merge-tree-reports-conflict?
  greps git merge-tree's CONTENT diff for the word "CONFLICT", which this
  repo's backlog prose contains constantly, so it fires on ordinary activity.
  Twelve resets have discarded local ahead commits, one of them destroying a
  human ruling three minutes after it was committed. BL-1236 is the real fix
  and is blocked on a human approval; the human's standing directive
  (2026-08-28 12:16Z) is to disable the sweep until it lands. No lever exists
  today: handoffd wires master-main-reconcile-sweep! unconditionally into its
  cadence block and swarmforge.conf carries no enable key.

  # IR-DRY: the checker flags `Given the config sets "..." to "false"` as a
  # near-duplicate across scenarios 02, 03 and 05. It is deliberately NOT
  # lifted into Background: scenario 01 parameterises that same key across
  # five values including "true", so hoisting one value would contradict the
  # outline rather than factor it. Extraction here is not meaning-preserving.
  Background:
    Given a swarmforge project root whose config is read by the handoff daemon

  # BL-1248 master-main-reconcile-kill-switch-01
  Scenario Outline: the switch decides whether the sweep runs, and fails closed
    Given the config sets "master_main_reconcile_enabled" to <value>
    When the handoff daemon runs one cadence tick
    Then the master-main-reconcile sweep <outcome>

    Examples:
      | value           | outcome      |
      | true            | runs         |
      | false           | does not run |
      | an absent key   | does not run |
      | an empty value  | does not run |
      | the word banana | does not run |

  # BL-1248 master-main-reconcile-kill-switch-02
  Scenario: with the sweep switched off, nothing it drives can touch local main
    Given the config sets "master_main_reconcile_enabled" to "false"
    And local main is ahead of origin by a commit no other ref contains
    When the handoff daemon runs one cadence tick
    Then no reconcile absorb, reset, or merge runs
    And that commit is still reachable from local main

  # BL-1248 master-main-reconcile-kill-switch-03
  Scenario: switching the sweep off is visible in the daemon log
    Given the config sets "master_main_reconcile_enabled" to "false"
    When the handoff daemon runs one cadence tick
    Then the daemon log records that the reconcile sweep was skipped by config

  # BL-1248 master-main-reconcile-kill-switch-04
  # RETIRE-WITH: BL-1236. This scenario pins a deliberately TEMPORARY state -
  # the shipped conf holding the sweep off - so it is red-when-correct: it goes
  # red the day an operator legitimately flips the switch on after BL-1236
  # lands. Whoever ships that flip retires this scenario (retire, never reword;
  # BL-1006). It is kept executable despite that cost because it is the only
  # gate on "shipped OFF", which is this ticket's entire deliverable - the
  # required_wiring substring check would pass on a commented-out key.
  Scenario: the shipped config disables the sweep
    When the shipped "swarmforge/swarmforge.conf" is read
    Then it sets "master_main_reconcile_enabled" to "false" with BL-1236 named as the condition for turning it back on

  # BL-1248 master-main-reconcile-kill-switch-05
  # Gates the ticket's firm constraint that the switch declines to ACT on
  # divergence without going QUIET about it. surface!/escalate! are injected
  # into master-main-reconcile-lib/sweep! and fire from inside it, so a guard
  # placed at handoffd's call site would suppress them too - this scenario is
  # what fails if the guard is put there.
  Scenario: switching the sweep off silences the reconcile, not the divergence report
    Given the config sets "master_main_reconcile_enabled" to "false"
    And local main and origin have diverged with local changes blocking a merge
    When the handoff daemon runs one cadence tick
    Then the drift between local main and origin is still recorded
    And the divergence is still surfaced to a human
