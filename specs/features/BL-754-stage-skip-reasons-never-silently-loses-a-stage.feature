Feature: a malformed stage_skip_reasons declaration is surfaced, never silently truncated

  take-flow-reason (required_stages_lib.bb:87-108) has three branches. The
  double-quoted branch is the only one any test or scenario exercises. The
  single-quoted branch - identical logic, a separate code path - is entirely
  untested. The bare/unquoted :else branch splits on the FIRST comma, and its
  failure mode is untested and worse than the originating note recorded.

  For `stage_skip_reasons: { cleaner: no test, obvious, architect: covered }`
  the :else branch returns ["no test" "obvious, architect: covered"]. The
  caller's loop then tries its `^([A-Za-z]+)\s*:\s*(.*)$` match against that
  remainder, which does not match because a comma sits before the colon, and
  the loop's `(if (nil? m) pairs ...)` returns what it has. The result is
  {cleaner "no test"} - architect's declared reason is gone, with no error
  anywhere. A stage's reason is not merely truncated, it is dropped.

  Quoted values are the live convention, so production exposure today is low.
  The defect is that the parser accepts present-but-malformed input and reports
  a partial result as though it were complete. This repo already settled the
  posture for the sibling declaration on the same header: resolve-effective
  surfaces a present-but-invalid required_stages as a returned rejection reason
  that the caller carries onto the routing-skip record - loudly, without
  throwing. Reading reasons feeds an observational record, never a control
  decision, so throwing would turn a cosmetic typo into a blocked handoff. The
  same posture applies here.

  Background:
    Given an active ticket carrying a stage_skip_reasons flow mapping

  # BL-754 quote-styles-equivalent-01
  Scenario Outline: either quote style keeps a comma inside the reason and the next stage still parses
    Given cleaner is declared with a <quote style> reason containing a comma
    And the same declaration goes on to declare architect
    When the stage skip reasons are read
    Then cleaner's reason is the whole text including the comma
    And architect's reason is read as declared
    And nothing is reported as malformed

    Examples:
      | quote style   |
      | double-quoted |
      | single-quoted |

  # BL-754 unquoted-comma-is-surfaced-02
  Scenario: an unquoted reason containing a comma is reported instead of silently losing a stage
    Given cleaner is declared with an unquoted reason containing a comma
    And the same declaration goes on to declare architect
    When the stage skip reasons are read
    Then the declaration is reported as malformed naming the unparseable remainder
    And the routing-skip record carries that report

  # BL-754 unquoted-simple-still-accepted-03
  Scenario: an unquoted reason with no comma is still accepted
    Given cleaner is declared with an unquoted reason containing no comma
    When the stage skip reasons are read
    Then cleaner's reason is read as declared
    And nothing is reported as malformed

  # BL-754 reading-reasons-never-blocks-a-hop-04
  Scenario: a malformed declaration never blocks the handoff it describes
    Given cleaner is declared with an unquoted reason containing a comma
    When the coder sends a git_handoff on that ticket
    Then the parcel is delivered to its recipient
    And the send does not abort with an uncaught exception
