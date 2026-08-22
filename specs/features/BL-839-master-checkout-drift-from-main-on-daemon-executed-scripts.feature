Feature: The swarm notices when the code it is executing is not the code that landed
  The daemons run straight out of the master checkout's working tree
  (`bb <repo>/swarmforge/scripts/handoffd.bb`), so that tree — not `main` — is
  production. Nothing checks the two agree. On 2026-08-06 the master checkout sat
  holding a complete, staged reversion of BL-835: `main` carried the shipped
  reject-gate fix, the file the daemon loads carried the pre-BL-835 floor-clamp,
  and both states were entirely silent. A QA-approved, closed ticket was simply
  not in effect, and one `git commit -a` from that checkout would have put the
  reversion on `main`. BL-373 already protects the role worktrees from this class;
  the master checkout, which is the one that actually executes, has no such guard.
  Source: found by the specifier 2026-08-06 while scoping BL-650.

  Background:
    Given the daemons execute scripts from the master checkout's working tree

  # BL-839 master-checkout-drift-01
  Scenario: agreement is silent
    Given every daemon-executed script in the master checkout matches main
    When the drift check runs
    Then it reports no drift
    And it raises no alarm

  # BL-839 master-checkout-drift-02
  Scenario Outline: a daemon-executed script that differs from main is reported
    Given a daemon-executed script in the master checkout <difference> main
    When the drift check runs
    Then it reports drift naming that script
    And it says which side is which

    Examples:
      | difference                     |
      | has uncommitted edits against  |
      | is staged for reversion out of |

  # BL-839 master-checkout-drift-03
  Scenario: the alarm says what is at stake, not just that files differ
    Given a daemon-executed script in the master checkout differs from main
    When the drift check runs
    Then the alarm states that the running code is not the landed code

  # BL-839 master-checkout-drift-04
  Scenario Outline: only executed code counts as drift
    Given <path> in the master checkout differs from main
    When the drift check runs
    Then it reports <verdict>

    Examples:
      | path                          | verdict  |
      | a daemon-executed script      | drift    |
      | an in-flight backlog ticket   | no drift |
      | an untracked scratch file     | no drift |

  # BL-839 master-checkout-drift-05
  Scenario: drift is reported, never repaired
    Given a daemon-executed script in the master checkout differs from main
    When the drift check runs
    Then the master checkout's working tree is left exactly as it was
    And nothing is staged, reverted, committed or discarded

  # BL-839 master-checkout-drift-06
  Scenario: a check that cannot run says so rather than reporting clean
    Given the drift check cannot resolve main
    When the drift check runs
    Then it reports that it could not determine drift
    And it does not report no drift
