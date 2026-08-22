Feature: a property runner's temp root is removed even when the run throws

  bl1025_expedite_approval_property_runner.bb creates its fixture root at line
  48 with fs/create-temp-dir and removes it at line 181 with fs/delete-tree —
  at top level, after the last assertion, in no try/finally and behind no
  shutdown hook. Line 181 is reached only when every preceding form completes.

  The runner has live throw paths. Its git helper throws ex-info on any
  non-zero git exit, and its exhaustive-sweep guard fails the run when the
  32-case table stops being swept. Either exits before line 181 and leaves a
  bl1025-prop-* directory behind permanently. Nothing traps a kill at all.

  This is the standing rule: a fixture dir is removed in a finally, never only
  after the last assertion, because a throw or a bounce otherwise leaks it
  forever. Two runners in this same directory already follow it — bl977 adds a
  JVM shutdown hook because "the end-of-run delete-tree below never runs when
  an exception (or a ...)", and bl887 adds the same, its comment naming the
  QA bounce under this very guard that put it there. Both keep their
  happy-path delete-tree as well; the hook is the abnormal-exit backstop, not
  a replacement.

  The throw paths themselves are legitimate and must survive: this is about
  cleanup, never about making the runner stop failing.

  Background:
    Given the BL-1025 expedite-approval property runner

  # BL-1033 temp-root-cleanup-01
  Scenario: a completed run leaves no fixture directory
    Given a run in which every property passes
    When the runner finishes
    Then no fixture directory from that run remains

  # BL-1033 temp-root-cleanup-02
  Scenario Outline: an abnormal exit still leaves no fixture directory
    Given a run that <ends>
    When the runner exits
    Then no fixture directory from that run remains

    Examples:
      | ends                                  |
      | throws from its git helper            |
      | fails its exhaustive-sweep guard      |

  # BL-1033 temp-root-cleanup-03
  Scenario: the runner still fails when a property is violated
    Given a run in which a property is violated
    When the runner exits
    Then it reports the failure and exits non-zero

  # BL-1033 temp-root-cleanup-04
  Scenario: the temp-dir-trap guard passes over the whole scripts tree
    Given the temp-dir-trap guard scanning swarmforge/scripts
    When the guard runs
    Then the guard reports no violations
