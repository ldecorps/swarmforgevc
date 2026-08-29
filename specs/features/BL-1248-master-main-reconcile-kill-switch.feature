# mutation-stamp: sha256=fa978d6cb6d43c53c8cd4d52c1c02b834f44247fcb2d65e1e26c880504536693
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-28T18:47:26.632913807Z","feature_name":"BL-1248 the master-main-reconcile sweep can be switched off from config, and is off until BL-1236 lands","feature_path":"/home/carillon/swarmforgevc/.worktrees/expedite-BL-1248/specs/features/BL-1248-master-main-reconcile-kill-switch.feature","background_hash":"df93e5c6917ac730b011e29d2b8a661fbf98a732a623c01ac3dbcdb9e156d02e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the switch decides whether the sweep runs, and fails closed","scenario_hash":"e246a347a6c92572c03df3203a1dd4aedc72bffd1ea4e1b87f29a978a2073741","mutation_count":10,"result":{"Total":10,"Killed":10,"Survived":0,"Errors":0},"tested_at":"2026-08-28T18:47:26.632913807Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1248 the master-main-reconcile sweep can be switched off from config

  The reconcile sweep decides whether to absorb origin into local main, and
  BL-1236 pins its conflict predicate as broken: merge-tree-reports-conflict?
  greps git merge-tree's CONTENT diff for the word "CONFLICT", which this
  repo's backlog prose contains constantly, so it fires on ordinary activity.
  Twelve resets have discarded local ahead commits, one of them destroying a
  human ruling three minutes after it was committed. The human's standing
  directive (2026-08-28 12:16Z) is to disable the sweep until BL-1236 lands.
  No lever exists: handoffd wires master-main-reconcile-sweep!
  unconditionally into its cadence block and swarmforge.conf carries no
  enable key.

  BL-1236 has since LANDED (871f2fa85, closed 112027d99), and the operator
  has since re-armed the sweep (cce70d985, the ON outcome of BL-1251) after a
  live clean-tree absorb proved merge-tree-clean and cleared a durable
  skipped-by-config deadlock. The shipped value is therefore `true` today.
  None of that retires this feature: the switch itself is what this ticket
  built, an on/off lever for a ref-rewriting sweep is worth having whichever
  defect prompted it, and every scenario below still describes what the lever
  does. What it DID retire is the scenario that pinned the shipped value at
  `false` - see the retirement note where scenario 04 stood.

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

  # BL-1248 master-main-reconcile-kill-switch-04 - RETIRED by BL-1251, 2026-08-29.
  # It read: "the shipped config disables the sweep ... sets
  # master_main_reconcile_enabled to false with BL-1236 named as the condition
  # for turning it back on". It pinned a deliberately TEMPORARY state and was
  # red-when-correct from the day an operator legitimately flipped the switch
  # on. That day came: cce70d985 re-armed the sweep on the operator's decision,
  # so the scenario asserted a state that had ended and was failing on main.
  # Retired, never reworded - rewording it to assert `true` would invent a
  # contract nobody agreed to, since the shipped value is now an operator's
  # standing choice rather than this ticket's deliverable. Its own RETIRE-WITH
  # marker named BL-1251 as its retirer, and this is that retirement.

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
