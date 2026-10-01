# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T14:59:43.788031542Z","feature_name":"BL-1465 BL-1375's passenger property asserts its invariant where the landed code now decides it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1465-the-bl1375-passenger-property-asserts-where-the-landed-code-decides.feature","background_hash":"6db61481ecf57c29d1017e4d582c6527b8d11c2f9fd773bc458e887a26e14c9a","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1465 BL-1375's passenger property asserts its invariant where the landed code now decides it

  BL-1375's second declared invariant - a passenger rides only through a
  self-consistent replayed tree - was written when land-plan returned a
  replay plan and replay! built and guarded the tree afterwards, so the
  property asks for a replay plan, runs replay! itself, and expects the
  consistency guard to refuse a dangling passenger line there. BL-1447
  (landed 2026-09-07) builds and verifies the tip-pure commit inside
  land-plan and escalates with the guard's own reason when the tree is
  inconsistent, so the dangling corner now refuses one step earlier and the
  property fails "the plan refused before the guard could speak" on its
  first draw. The invariant holds; the property asserts it at the wrong
  point. Because the property lane's commit guard refuses any commit with a
  non-allowlisted red, this one file blocked every extension/src commit
  swarm-wide until its allowlist row landed with this ticket.

  BL-1830 (the human's ruling A, 2026-09-30) rebuilds a shared own path
  without any unlanded sibling's lines, so no passenger rides. Scenarios
  01 and 02 planned a passenger through land-plan; they are retired (never
  reworded - BL-1006) by the BL-1876 hotfix. Scenarios 03 and 04 stand.

  Background:
    Given a fixture repository with a landing ticket, an approved unlanded passenger sibling sharing a path, and the sibling's own handler path excluded from the replay

  # BL-1465 the-property-file-is-green-alone-and-in-the-lane-03
  Scenario: the property file is green alone and in the full lane with both reach floors kept
    When the bl1375 property file runs alone under the property lane's runner
    Then all three invariants pass
    And the run exercised at least one dangling and at least one resolved passenger line

  # BL-1465 the-allowlist-and-register-rows-leave-with-the-fix-04
  Scenario: the allowlist row and the register row leave with the fix
    When the fix is on main
    Then the property allowlist carries no row for the bl1375 property file
    And backlog/standing-reds.tsv carries no row for it either
