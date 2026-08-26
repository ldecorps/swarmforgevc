Feature: handoffd deliver! paren fix verified independently of BL-636 commit-message claims
  BL-636's landing commit (6a2e4aaf6) claimed it restored a deliver! close
  paren dropped by BL-611 that blocked one-shot handoffd flags under streaming
  eval. That token appears nowhere in 6a2e4aaf6's own patch; the explicit
  repair existed only on unmerged sibling commit 79c5d09b8. Main may still be
  fixed — but only incidentally, by BL-611's unrelated enqueue removal.

  This slice verifies the underlying bug independently of any commit message,
  records which change on main actually closes it, and locks one-shot flags
  so the class cannot regress silently.

  Background:
    Given a throwaway project root with a fake tmux socket and roles.tsv
    And handoffd.bb is invoked from that fixture root

  # BL-728 handoffd-loads-under-bb-01
  Scenario: handoffd.bb loads under Babashka without a read or eval error
    When handoffd.bb is loaded by Babashka from the fixture root
    Then the load completes without a syntax or unmatched-delimiter error

  # BL-728 one-shot-poll-once-completes-02
  Scenario Outline: one-shot handoffd flags run to their done log line
    When handoffd.bb is invoked with "<flag>"
    Then the daemon log contains "<done_line>"
    And handoffd exits without a load-time syntax failure

    Examples:
      | flag               | done_line              |
      | --poll-once        | poll-once done         |
      | --sweep-once       | sweep-once done        |
      | --chase-sweep-once | chase-sweep-once done  |

  # BL-728 deliver-paren-balanced-03
  Scenario: deliver! in handoffd.bb is syntactically balanced on main
    Given the source of swarmforge/scripts/handoffd.bb at the parcel commit
    When the deliver! form is extracted and its parentheses are counted
    Then open and close counts are equal

  # BL-728 evidence-names-closing-commit-04
  Scenario: verification evidence names which commit actually closed deliver!, not BL-636's landing commit
    Given verification has traced deliver! on main and the BL-636 landing commit 6a2e4aaf6
    When the evidence file for this ticket is written
    Then it states whether the one-shot flag bug is fixed on main today
    And it names the commit that actually balanced deliver! with commit references
    And it records that 6a2e4aaf6's own patch did not restore deliver! or change its closing parens

  # BL-728 live-defect-only-if-broken-05
  Scenario: a still-broken one-shot path is fixed in this parcel instead of only documented
    Given verification finds a one-shot flag that fails to reach its done log
    When the parcel completes
    Then the defect is repaired on main in this parcel
    And the evidence file records the repair commit
