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
  Scenario: the shipped config disables the sweep
    When the shipped "swarmforge/swarmforge.conf" is read
    Then it sets "master_main_reconcile_enabled" to "false" with BL-1236 named as the condition for turning it back on
