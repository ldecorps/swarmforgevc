Feature: The swarm launcher's mutation_cost pre-pass never fabricates a junk ticket for an empty paused backlog

  # The repo-root ./swarm launcher estimates mutation_cost for paused backlog
  # items via an unguarded `backlog/paused/*.yaml` glob. With bash nullglob off,
  # an empty paused dir leaves the literal pattern as the loop variable, which
  # both prints "No such file or directory" noise and appends a line to a real
  # file literally named "*.yaml" — a junk ticket the coordinator then scans.
  # The fix must suppress both effects while leaving estimation unchanged when
  # the paused dir does contain yaml files.

  # BL-224 empty-paused-glob-01
  Scenario: launching with an empty paused backlog creates no junk ticket and no glob noise
    Given backlog/paused/ contains no ".yaml" files
    When the swarm launcher runs its mutation_cost pre-pass
    Then no file named "*.yaml" is created in backlog/paused/
    And the launcher proceeds without a "No such file or directory" error on stderr

  # BL-224 estimation-preserved-02
  Scenario: a paused item missing mutation_cost still gets one estimated
    Given backlog/paused/ contains a ".yaml" item with no "mutation_cost:" field
    When the swarm launcher runs its mutation_cost pre-pass
    Then that item gains a "mutation_cost:" field

  # BL-224 estimation-untouched-03
  Scenario: a paused item that already has mutation_cost is left unchanged
    Given backlog/paused/ contains a ".yaml" item that already has a "mutation_cost:" field
    When the swarm launcher runs its mutation_cost pre-pass
    Then that item is left byte-for-byte unchanged

# Non-behavioral gates:
#  - Regression guard: an automated check asserts that a pre-pass over an empty
#    backlog/paused/ creates no file named '*.yaml' and emits no glob stderr noise.
#  - The three scenarios share no common Given (each sets a distinct paused-dir
#    state), so no Background extraction is meaning-preserving. The identical
#    When across sibling scenarios is intentional — each is a distinct behavior.
