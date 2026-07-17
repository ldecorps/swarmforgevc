# mutation-stamp: sha256=a8fa70c241639ced6368361d059023863cc7def3fff3b1a4030359ff82dfd56b
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T14:59:35.307880141Z","feature_name":"the chase sweep never re-chases an already-completed handoff still lingering in new/","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-499-chase-sweep-rechases-resolved-new-duplicate.feature","background_hash":"d8494b6a4d82c3584b4c29ef93f5b9eb2c121a253ceace4fc2c32e9494afbddf","implementation_hash":"unknown","scenarios":[{"index":0,"name":"an already-terminal handoff lingering in new/ is reaped, never chased","scenario_hash":"a2aef356601518351451e18f9b77cbae38a3d351f1d4d1ffe438ba302717ca69","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-17T14:59:35.307880141Z"}]}
# acceptance-mutation-manifest-end

Feature: the chase sweep never re-chases an already-completed handoff still lingering in new/

  # BL-499 (dispositioned from a coordinator rule_proposal, live 2026-07-17). The chase
  # sweep (chase_sweep_lib.bb: scan-inbox-new -> decide-item-action -> sweep-role-inbox!)
  # enumerates every handoff in inbox/new/ with NO dedup against completed/ or abandoned/,
  # so it does not apply the BL-218 already-processed skip the DEQUEUE path applies. For a
  # new/ handoff whose id is already terminal (its work is done, so the recipient's own
  # intake will forever skip it), decide-item-action returns "chased" every cycle while the
  # recipient is active (the dead-letter path is only reachable when the recipient is idle),
  # with no cap — so the stale duplicate wakes a busy agent forever, silently (chaseCount
  # hit 12+ in one session). This is the chase-sweep sibling of BL-218's intake fix: apply
  # the SAME already-terminal check (reuse handoff_lib/already-terminal?) at sweep time and
  # REAP the resolved duplicate instead of chasing it. The reap MECHANISM (delete vs
  # move-to-terminal) is the architect's call; the scenarios below hold either way.

  Background:
    Given a role mailbox with new/, in_process/, completed/, and abandoned/
    And a stale copy sits in new/ with an mtime older than the chase timeout

  # BL-499 chase-sweep-terminal-dup-01
  Scenario Outline: an already-terminal handoff lingering in new/ is reaped, never chased
    Given a handoff whose id already exists in <state>/
    And the recipient role has recent activity
    When the chase sweep runs for the role
    Then no wake-up is sent for the stale copy and its chase count is not incremented
    And the stale copy is reaped from new/ and never promoted to in_process/
    And the reap is recorded as an auditable "already-processed" line

    Examples:
      | state     |
      | completed |
      | abandoned |

  # BL-499 chase-sweep-terminal-dup-02
  Scenario: an idle role reaps a terminal duplicate rather than raising a false dead-letter
    Given a handoff whose id already exists in completed/
    And the recipient role is idle with the stale copy's chase count already at the dead-letter threshold
    When the chase sweep runs for the role
    Then the stale copy is reaped from new/ and never promoted to in_process/
    And the stale copy is not dead-lettered

  # BL-499 chase-sweep-terminal-dup-03
  Scenario: a genuinely stuck handoff to an active role is still chased as before
    Given a handoff in new/ whose id is in neither completed/ nor abandoned/
    And the recipient role has recent activity
    When the chase sweep runs for the role
    Then the handoff is chased and a wake-up is sent for it
    And its chase count is incremented

  # BL-499 chase-sweep-terminal-dup-04
  Scenario: reaping a terminal duplicate leaves no orphaned chase sidecar behind
    Given a handoff whose id already exists in completed/
    And the stale copy in new/ has a ".chase.json" sidecar beside it
    When the chase sweep runs for the role
    Then the stale copy is reaped from new/ and never promoted to in_process/
    And no ".chase.json" sidecar for it remains in new/

# Non-behavioral gates:
#  - The dedup decision is a pure function over provided directory listings (fixtures);
#    reuse handoff_lib/already-terminal? / dedup-new-candidates — never a second copy.
#  - The reap check takes precedence over BOTH the chase (active role) and the dead-letter
#    (idle role) branches of decide-item-action.
#  - Scope is STRICTLY the already-terminal duplicate; the genuine-stuck chase and idle
#    dead-letter paths are unchanged (scenario 03 is the regression guard).
#  - Encodes engineering.prompt's "Mailbox intake is idempotent" Guardrail and the
#    bounded-retry rule at the SWEEP layer (the dequeue layer is BL-218).
