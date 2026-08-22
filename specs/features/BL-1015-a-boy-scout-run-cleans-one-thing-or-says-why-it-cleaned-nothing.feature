Feature: A Boy Scout run cleans one thing, or says why it cleaned nothing

  The Boy Scout Rule is small, immediate and opportunistic: leave the
  campground cleaner than you found it, now, without turning it into an
  expedition. So a run takes the top-ranked item from the scan and cleans
  exactly that one, inside a declared size envelope, and refuses anything
  bigger rather than half-doing it.

  The envelope is derived, not invented: BL-634 recorded a 65-insertion
  median for a normal slice, so a Boy Scout cleanup - which should be smaller
  than a normal slice, not larger - is capped at 3 files and 120 changed
  lines.

  Two failure modes matter more than the happy path. A cleanup that can only
  reach green by editing an existing test assertion is not a cleanup, it is a
  behaviour change wearing a refactor's clothes. And a run that quietly does
  nothing is indistinguishable from a run that found nothing.

  Background:
    Given a ranked debt inventory from a Boy Scout scan

  # BL-1015 boy-scout-run-01
  Scenario: the run cleans the top-ranked item and leaves the rest alone
    Given the top-ranked item fits the size envelope
    When the Boy Scout run executes
    Then that item is cleaned
    And no other ranked item is touched

  # BL-1015 boy-scout-run-02
  Scenario Outline: an item larger than the envelope is refused whole
    Given the top-ranked item would change <files> files and <lines> lines
    When the Boy Scout run executes
    Then the run outcome is <outcome>

    Examples:
      | files | lines | outcome |
      | 1     | 40    | cleaned |
      | 3     | 120   | cleaned |
      | 4     | 40    | refused |
      | 1     | 400   | refused |

  # BL-1015 boy-scout-run-03
  Scenario: a refusal names the item and the envelope it exceeded
    Given the top-ranked item exceeds the size envelope
    When the Boy Scout run executes
    Then the report names that item
    And the report names the envelope it exceeded

  # BL-1015 boy-scout-run-04
  Scenario: a cleanup needing an existing test edited is abandoned, not forwarded
    Given the top-ranked item cannot be cleaned without changing an existing test assertion
    When the Boy Scout run executes
    Then the cleanup is abandoned
    And the report states that the item needs its own ticket

  # BL-1015 boy-scout-run-05
  Scenario: a failing gate on the cleaned result abandons the cleanup
    Given the top-ranked item fits the size envelope
    And the repository gate set fails on the cleaned result
    When the Boy Scout run executes
    Then the cleanup is abandoned
    And no cleanup is committed

  # BL-1015 boy-scout-run-06
  Scenario: a run that cleans nothing states which reason applied
    Given the ranked inventory is empty
    When the Boy Scout run executes
    Then the report states why nothing was cleaned
