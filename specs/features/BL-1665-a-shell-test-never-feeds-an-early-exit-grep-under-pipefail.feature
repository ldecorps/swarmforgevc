Feature: BL-1665 A shell test under pipefail never feeds grep -q through a pipe, and a guard keeps it so

  Under set -o pipefail, `echo "$OUT" | grep -q needle` fails whenever
  grep matches an early line and exits while echo is still writing the
  rest: echo dies of SIGPIPE, the pipeline reports 141, and the assertion
  reads a present needle as absent. It fails only under load, so it
  reads as a flake (BL-1660 in a library, test_merge_deletion_guard.sh
  case 02 on 2026-09-20). 125 of the 408 shell tests carry the shape, 732
  sites. After this parcel every such pipe consumes its whole input, and
  a guard in the commit chain refuses a new one.

  Background:
    Given a fixture repository under a temporary directory with the commit guard chain installed

  # BL-1665 a-new-early-exit-pipe-is-refused-01
  Scenario Outline: a staged shell test under pipefail that pipes into an early-exit grep is refused naming the file and line
    Given a staged shell test under swarmforge/scripts/test that sets pipefail and pipes a captured output into <consumer>
    When the commit runs the guard chain
    Then the commit is refused naming the file and the line number

    Examples:
      | consumer                 |
      | grep -q needle           |
      | grep -qiE needle-pattern |

  # BL-1665 a-whole-input-consumer-passes-02
  Scenario Outline: a staged shell test whose assertions consume their whole input is accepted
    Given a staged shell test under swarmforge/scripts/test that sets pipefail and asserts with <assertion>
    When the commit runs the guard chain
    Then the commit is accepted

    Examples:
      | assertion                              |
      | a pipe into grep needle redirected to dev-null |
      | a bash pattern test on the captured output     |

  # BL-1665 a-test-without-pipefail-is-not-judged-03
  Scenario: a staged shell test that never sets pipefail is not judged
    Given a staged shell test under swarmforge/scripts/test that never sets pipefail and pipes a captured output into grep -q needle
    When the commit runs the guard chain
    Then the commit is accepted

  # BL-1665 the-real-tree-is-clean-and-the-census-is-pinned-04
  # Census pin (BL-1445): the derivation must see the whole population.
  Scenario: the real tree carries no early-exit grep pipe under pipefail and the scan covered every shell test
    When the guard scans every shell test under swarmforge/scripts/test
    Then it names no file
    And it reports having scanned at least 400 files
