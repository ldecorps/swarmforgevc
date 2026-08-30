Feature: A fixture's liveness is decided by identity, not by a bare pid signal

  bl857TunnelOwnershipInvariants decides every "did the reap kill it?"
  assertion with isAlive(pid) — `process.kill(pid, 0)`. That answers "does
  some process with this pid exist", which is not the question the invariant
  asks. Two things make the two answers diverge, and both get more likely the
  busier the host is:

  a SIGKILLed process stays signallable as an unreaped zombie until its
  reaper collects it; and a pid freed by the reap can be REUSED by any of the
  thousands of processes a full suite run spawns, so the check answers about
  a different process entirely.

  QA reports invariant 3 red in the full lane and clean 3/3 solo, with
  counterexample [prefixed, false] — the case where the target is NOT
  registered and must therefore be reaped. Both mechanisms produce exactly
  that failure, and an identity-checked liveness answer closes both without
  needing to know which one fired.

  Background:
    Given a fixture process the reap has just signalled

  # BL-1292 fixture-liveness-identity-01
  Scenario Outline: Liveness answers about the fixture, not about the pid
    Given the pid is <situation>
    When the test asks whether the fixture is still alive
    Then the answer is <answer>

    Examples:
      | situation                                  | answer |
      | still running the fixture                  | alive  |
      | a zombie awaiting its reaper               | gone   |
      | reused by an unrelated process             | gone   |
      | absent entirely                            | gone   |

  # BL-1292 fixture-liveness-identity-02
  Scenario: An unregistered target is reaped, and the test can tell
    Given a target bound to its own unique tunnel name and never registered
    When a reap scoped to the target runs
    Then the target is reported gone by an identity-checked liveness answer

  # BL-1292 fixture-liveness-identity-03
  # The bystander half must not regress: a near-miss name still survives.
  Scenario: A near-miss bystander still survives the reap
    Given a bystander whose tunnel name merely extends the target's
    When a reap scoped to the target runs
    Then the bystander is still alive under the same identity check
