Feature: a fixture-droppings alert respects the same grace period as its siblings

  babysitter_assess_lib.bb builds severity as one `cond` (lines 114-123). Two
  file-state branches are gated on the claim having aged - :warn-uncommitted
  and :watch each require `(>= elapsed-pct 0.75)`. The third, added later, is
  not:

      (and head-unchanged? fixture-droppings?) :warn-fixture-droppings

  alert-severity? includes it, so it wakes the babysitter LLM. head-unchanged?
  is true from the instant a claim is taken - the claim commit IS the head - so
  a role that claimed a ticket seconds ago wakes the babysitter immediately if
  any known fixture dropping is lying in its worktree.

  Being first in the `cond`, the ungated branch also shadows the gated one: a
  worktree whose untracked files are all fixture droppings can no longer reach
  :warn-uncommitted, so it does not merely skip its own grace period, it
  bypasses the grace period the sibling branch would have applied.

  Waiting is the right default here because the observation is not stable. This
  repo's own engineering rule has fixture dirs removed in a `finally`, so a
  suite that is mid-run legitimately holds exactly these files and will clear
  them itself moments later. Alerting at once turns a running test into an
  operator wake.

  The boundary is not merely ungated, it is unexercised: the one test added for
  this branch always builds claimAtMs 15 minutes in the past whatever
  idle-timeout is configured, so it can never observe the grace edge move.

  Background:
    Given a role holding an in_process claim whose worktree head still matches its claim commit
    And the worktree's untracked files are all known test-fixture droppings

  # BL-750 grace-boundary-follows-configured-timeout-01
  Scenario Outline: the fixture-droppings alert fires only once the claim has aged, on the configured scale
    Given the configured claim idle timeout is <idle timeout>
    And the claim was taken <claim age> ago
    When the claim risks are assessed
    Then the assessment <alert outcome>

    Examples:
      | idle timeout | claim age  | alert outcome                          |
      | 20 minutes   | 5 minutes  | reports no alert-worthy severity       |
      | 20 minutes   | 18 minutes | reports the fixture-droppings severity |
      | 4 minutes    | 5 minutes  | reports the fixture-droppings severity |

  # BL-750 aged-claim-keeps-its-hint-02
  Scenario: once it does fire the alert still says to fix the suite, not to commit
    Given the claim has aged past the grace period
    When the claim risks are assessed
    Then the assessment reports the fixture-droppings severity
    And its hint names the leaking test suite as the thing to fix
    And its hint does not advise committing the untracked files

  # BL-750 reclaim-signals-are-not-grace-gated-03
  Scenario: a reclaim-driven severity still wakes immediately on a fresh claim
    Given the role has reclaimed its claim past the warn threshold
    And the claim was taken well inside the grace period
    When the claim risks are assessed
    Then the assessment reports an alert-worthy severity
