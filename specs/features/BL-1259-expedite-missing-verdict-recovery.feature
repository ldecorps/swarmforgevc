Feature: A stage that writes no verdict is recovered, bounded, and never bounced on its own absence

  The offline expeditor drives one ticket through the role stages by invoking a
  headless agent per stage and reading the verdict JSON that stage writes. When
  a stage exits without writing one, the driver has no information: it does not
  know whether the stage passed, failed, or simply parked on a background wait
  and gave up.

  Three landed hotfixes shaped the answer. The absence of a verdict is worth ONE
  or TWO more attempts with a prompt that forbids standby waits, and after that
  it is a failure — never a bounce. Synthesizing "bounce, because there was no
  verdict" re-enters the same stage carrying no new information for it to act
  on, and spends the ticket's bounce budget doing it.

  These scenarios certify that landed behaviour. They do not propose changing
  it.

  Background:
    Given the expeditor is driving a ticket through a stage
    And the stage writes its verdict to a verdict file the driver reads

  # BL-1259 expedite-missing-verdict-recovery-01
  Scenario: A stage that exits without a verdict is re-invoked rather than failed
    Given the stage exited within its time budget
    And the stage wrote no parseable verdict
    And the stage has been recovered 0 times
    When the driver decides what to do with the finished stage
    Then it re-invokes the same stage
    And the re-invocation is told that the previous session wrote no verdict
    And the re-invocation is forbidden from standing by for background jobs

  # BL-1259 expedite-missing-verdict-recovery-02
  Scenario Outline: Recovery is bounded, and exhausting it fails rather than bounces
    Given the stage exited within its time budget
    And the stage wrote no parseable verdict
    And the stage has been recovered <recoveries> times
    When the driver decides what to do with the finished stage
    Then it <action>

    Examples:
      | recoveries | action                                    |
      | 0          | re-invokes the same stage                 |
      | 1          | re-invokes the same stage                 |
      | 2          | records a failed verdict of class no-verdict |
      | 3          | records a failed verdict of class no-verdict |

  # BL-1259 expedite-missing-verdict-recovery-03
  Scenario: The second recovery escalates the instruction it gives the stage
    Given the stage wrote no parseable verdict
    And the stage has been recovered 2 times
    When the driver builds the re-invocation instruction
    Then the instruction states that the stage has twice exited without a verdict
    And the instruction demands a verdict be written before the process exits

  # BL-1259 expedite-missing-verdict-recovery-04
  Scenario: A timeout is reported as a timeout even when no verdict was written
    Given the stage was killed for exceeding its time budget
    And the stage wrote no parseable verdict
    When the driver decides what to do with the finished stage
    Then it records a failed verdict of class stage-timeout
    And it does not record a failed verdict of class no-verdict
    And it does not re-invoke the stage

  # BL-1259 expedite-missing-verdict-recovery-05
  Scenario Outline: A bounce is only honoured when it carries something to act on
    Given a stage returned a bounce verdict with reason "<reason>" and class "<class>"
    When the driver decides whether to honour the bounce
    Then the bounce is <verdict>

    Examples:
      | reason                       | class                | verdict  |
      | coverage gap in the CLI seam |                      | honoured |
      |                              | missing-unit-test    | honoured |
      |                              |                      | refused  |
      |                              | no-verdict-abandoned | refused  |
      | no-verdict                   |                      | refused  |
