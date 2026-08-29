Feature: BL-1265 the declared fixture dependency list matches the real transitive closure, and the guard that says so is armed in both directions

  A fixture that loads the operator runtime needs every Babashka file that
  runtime transitively load-files. That set is written down by hand, and a
  hand-written set drifts - six times before a guard was built to derive the
  real closure from source and compare the two.

  The guard works. It is reporting a seventh drift: four files are reachable
  from the operator runtime and absent from the declared list. Because the
  comparison lives in the suite every parcel runs, the drift has been visible
  since it happened - carried as a standing red rather than acted on, which
  is the state the guard exists to end. While it is red it cannot report the
  eighth drift, because a failing test cannot fail louder.

  Declaring the four is the fix. The guard also accepts declared exceptions,
  for entries kept in the list despite not being reachable, and that door is
  the wrong one here: these four are genuinely reachable, and moving them
  through it would turn the guard green while leaving the list wrong.

  Background:
    Given the operator runtime's real transitive load-file closure

  # BL-1265 the-declared-closure-matches-the-real-one-01
  Scenario: every reachable dependency is declared, and nothing undeclared is listed
    When the declared list is compared against the real closure
    Then no reachable file is reported missing
    And no listed file is reported as an undeclared extra

  # BL-1265 the-declared-closure-matches-the-real-one-02
  Scenario Outline: the guard still detects drift in both directions after the fix
    Given the declared list is perturbed by <perturbation>
    When the declared list is compared against the real closure
    Then the guard reports that entry as <report>

    Examples:
      | perturbation                            | report          |
      | removing a reachable dependency         | missing         |
      | adding a name no file reaches           | undeclared extra |

  # BL-1265 the-declared-closure-matches-the-real-one-03
  Scenario: the closure is declared as it stands, not reshaped to fit the list
    When the correction lands
    Then no Babashka source file under the scripts directory is modified
