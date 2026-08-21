Feature: the expeditor's default per-stage budget holds, and every place that states it agrees

  # BL-1026. The budget is the expeditor's only self-observation: by stopping
  # the stack it kills the babysitter and the Operator, so it must observe
  # itself. It is pure wall-clock and the CLI enforces it by killing the
  # stage's whole process group, so it cannot tell a wedged stage from a
  # working one - and at 45 minutes it did not. Run 1 of the BL-1021 expedite
  # killed its coder stage at the budget while that stage was producing work
  # run 2 then reused from a checkpoint. The value is stated in five places -
  # the constant, two usage comments, two documents - and nothing gates them:
  # the one test that touches it asserts the constant against itself, so it
  # passes for any value and says nothing about the four prose mirrors.
  #
  # No scenario below names the budget in minutes, deliberately. Pinning the
  # number here would mint a sixth hand-mirrored copy of the constant this
  # feature exists to gate, and would go red the next time it is retuned.
  # Every duration is expressed relative to the budget in force; scenarios 02
  # and 03 are what hold the stated value and the code together.

  # BL-1026 a-stage-is-judged-against-the-budget-in-force-01
  Scenario Outline: a stage is judged against its own budget when it has one, the default when it does not
    Given a stage with <budget>
    When it has been running for <elapsed>
    Then the overrun verdict is <overrun>
    And the budget the verdict reports is <reported>

    Examples:
      | budget                               | elapsed                                        | overrun | reported            |
      | no explicit per-stage budget         | just under the default budget                  | false   | the default         |
      | no explicit per-stage budget         | exactly the default budget                     | true    | the default         |
      | no explicit per-stage budget         | well past the default budget                   | true    | the default         |
      | an explicit budget under the default | past its explicit budget but under the default | true    | the explicit budget |

  # BL-1026 every-stated-budget-agrees-with-the-code-02
  Scenario: every place the expeditor states its default agrees with the code
    When every place the expeditor states its default per-stage budget is read
    Then each of them states the same budget as the code

  # BL-1026 the-agreement-check-can-fail-03
  Scenario: the agreement check is not vacuous - it goes red when one place disagrees
    Given one place the expeditor states its default is changed to a different budget
    When every place the expeditor states its default per-stage budget is read
    Then the disagreement is reported
    And the place that disagrees is named
