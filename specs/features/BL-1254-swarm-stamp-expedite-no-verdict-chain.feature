Feature: Stamp-off review of the Cursor expedite no-verdict hotfix chain 3f4f69ec1b, 70c5e0e5b0, 5de352ed1d

  Three operator/Cursor hotfixes landed on main in one day against the same
  expedite no-verdict path, each with the trailer Hotfix-Certification:
  pending. An offline `claude -p` stage parked on a Monitor wait, exited 0
  without writing verdict.json, and the driver hard-failed the ticket.

  They are reviewed together because the third supersedes part of the
  second: 70c5e0e5b0 made a second miss bounce back to the same stage, and
  5de352ed1d refuses exactly that synthesized reasonless bounce. Certifying
  70c5e0e5b0 on its own would certify behaviour that is no longer live.
  The scenarios below therefore describe the RESULTING state at 5de352ed1d.

  This is a BL-848 stamp-off. It CONFIRMS OR REFUTES the landed commits; it
  never reimplements or redesigns them. Green scenarios alone never certify -
  only a recorded human decision writes certified or waived into
  backlog/hotfix-ledger.yaml.

  Background:
    Given the landed expedite driver sources at commit 5de352ed1d

  # BL-1254 expedite-no-verdict-chain-stamp-01
  Scenario Outline: A stage that exits without a verdict is re-invoked while recoveries remain
    Given an expedite stage has exited without a parseable verdict <attempt> times
    When the driver decides what to do next
    Then the driver <outcome>

    Examples:
      | attempt | outcome                          |
      | 1       | re-invokes the stage             |
      | 2       | re-invokes the stage             |
      | 3       | fails the ticket closed          |

  # BL-1254 expedite-no-verdict-chain-stamp-02
  Scenario: A recovery prompt escalates rather than repeating
    Given a stage is being re-invoked after a missing verdict
    When the driver builds the stage prompt
    Then the prompt forbids waiting on background or Monitor work
    And the prompt requires writing a pass, bounce or fail verdict as the last action

  # BL-1254 expedite-no-verdict-chain-stamp-03
  Scenario Outline: A bounce must carry an actionable reason to count as a bounce
    Given a stage returns a bounce whose reason and class are <payload>
    When the driver validates the bounce
    Then the bounce is <verdict>

    Examples:
      | payload                          | verdict  |
      | an actionable reason             | accepted |
      | both blank                       | refused  |
      | the synthetic no-verdict tag     | refused  |

  # BL-1254 expedite-no-verdict-chain-stamp-04
  Scenario: A refused bounce does not consume the bounce bound
    Given a stage returns a bounce the driver refuses as reasonless
    When the driver records the stage result
    Then the ticket is not re-entered at the same stage on that bounce

  # BL-1254 expedite-no-verdict-chain-stamp-05
  Scenario: The ledger rows stay pending until a human decides
    Given the review scenarios above are green
    When the stamp-off completes without a recorded human decision
    Then no hotfix ledger row in this chain is certified or waived
