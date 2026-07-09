Feature: role branches are namespaced by swarm identity

# BL-106 branch-ns-01
Scenario: launcher derives branch names from swarm_name
  Given a conf with swarm_name alpha
  When the swarm launches its worktrees
  Then every role worktree is on branch alpha/<role>

# BL-106 branch-ns-02
Scenario: two swarms share a repo without collisions
  Given worktree sets for swarm_names alpha and beta on one repo
  When both are inspected
  Then no branch ref is shared between them
  And each swarm's helpers address only its own namespace

# BL-106 branch-ns-03
Scenario: mismatched branch fails fast
  Given a worktree on a branch outside its swarm_name namespace
  When the launcher validates at startup
  Then launch fails with a message naming the expected branch

# BL-106 branch-ns-04
Scenario: migration preserves everything
  Given the current mixed-scheme branches
  When the migration runs
  Then each role worktree is on its unified branch with identical HEAD
  And stale duplicate role branches are removed only if fully merged

# Non-behavioral gates:
#  - Derivation/validation logic script-tested; migration rehearsed on
#    a scratch clone before the live run.
#  - No history rewrite; branch renames only.
