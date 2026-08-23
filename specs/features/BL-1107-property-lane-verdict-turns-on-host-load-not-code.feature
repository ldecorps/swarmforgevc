Feature: A property lane verdict turns on the code, not on host load

  bl796's property 3 draws 12 random samples over a six-point input space,
  building temp dirs and spawning a real shell each time, inside a 20 second
  per-test budget it takes no override for. BL-1063 gave the sibling property
  a 120000 override and left this one on the lane default, so under the
  host's normal load the lane reds on correct code.

  Over half that work is redundant - and because the draw is random with
  replacement, twelve draws over six points still do not guarantee all six
  are reached. The fix is to cover the space by construction rather than to
  buy more time for sampling it twice.

  Background:
    Given the property lane's per-test budget is 20 seconds

  # BL-1107 verdict-not-load-01
  Scenario: The file passes on a loaded host
    Given the host is under the load of a normal shift
    When the property lane runs the bl796 file
    Then every property in it passes
    And none of them ends by exceeding the per-test budget

  # BL-1107 verdict-not-load-02
  Scenario Outline: A property spawns no more subprocesses than its space has points
    Given property "<property>" whose input space holds <points> points
    When the property lane runs it
    Then it spawns at most <points> subprocesses

    Examples:
      | property | points |
      | 2        | 4      |
      | 3        | 6      |

  # BL-1107 verdict-not-load-03
  Scenario: Coverage of a small finite space is by construction, not by draw
    Given property 3 whose space is every binary paired with every position
    When the property lane runs it repeatedly
    Then every pair is exercised on every run
    And which pairs were exercised does not differ between runs

  # BL-1107 verdict-not-load-04
  Scenario: The property still fails when the behaviour it proves is broken
    Given property 3 and a caller binary shadowed by a discovered installation
    When the property lane runs it
    Then it fails because the caller's binary did not win
    And it does not fail by exceeding the per-test budget
