# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T06:03:36.821511Z","feature_name":"BL-966 depth CLI gives the same answer from every checkout","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-966-depth-cli-same-answer-from-every-checkout.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-966 depth CLI gives the same answer from every checkout

  The effective-depth resolution reads swarm-identity at the caller's own
  root, and worktrees carry no .swarmforge/, so a worktree caller silently
  gets the tracked default conf's cap while master resolves the launched
  pack's cap. The resolution must find the repository's master-checkout
  identity from any linked checkout, surface the true no-identity
  fall-through loudly, and leave non-git fixture roots untouched.

  # BL-966 depth-same-answer-01
  Scenario: a linked worktree resolves the same cap as the master checkout
    Given a scratch git repository whose master checkout carries a swarm-identity naming a pack conf with cap 7
    And a linked worktree of that repository
    When the depth CLI runs against the worktree root
    Then it prints cap 7 with nothing on stderr

  # BL-966 depth-same-answer-02
  Scenario: the master checkout keeps resolving its identity's pack conf
    Given a scratch git repository whose master checkout carries a swarm-identity naming a pack conf with cap 7
    When the depth CLI runs against the master checkout root
    Then it prints cap 7 with nothing on stderr

  # BL-966 depth-same-answer-03
  Scenario: a repository with no swarm-identity falls back loudly, not silently
    Given a scratch git repository with no swarm-identity in any checkout
    And its tracked default conf sets cap 3
    When the depth CLI runs against the master checkout root
    Then it prints cap 3 and exits 0
    And stderr carries a fall-through notice naming the default conf

  # BL-966 depth-same-answer-04
  Scenario: a plain non-git scratch root keeps today's stdout and exit code
    Given a plain temp-dir root that is not a git repository, with a tracked default conf setting cap 3
    When the depth CLI runs against that root
    Then it prints cap 3 and exits 0
    And stderr carries a fall-through notice naming the default conf
