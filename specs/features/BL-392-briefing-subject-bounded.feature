Feature: the briefing email subject is a bounded, readable headline — not the whole lede

  Background:
    Given the briefing email subject is built from the briefing's date and first non-empty line

  # BL-392 subject-bound-01
  Scenario: a long lede line is truncated to a bounded headline
    Given a briefing whose first non-empty line is longer than the headline limit
    When the briefing email subject is built
    Then the subject names the briefing date
    And its headline is no longer than the headline limit
    And the headline is cut at a word boundary and ends with an ellipsis

  # BL-392 subject-bound-02
  Scenario: markdown markers are stripped from the headline
    Given a briefing whose first non-empty line contains bold and heading markdown
    When the briefing email subject is built
    Then the subject contains no markdown emphasis or heading markers

  # BL-392 subject-bound-03
  Scenario: a headline already within the limit passes through unchanged
    Given a briefing whose first non-empty line is shorter than the headline limit
    When the briefing email subject is built
    Then the subject's headline is that line unchanged
    And the subject contains no ellipsis

  # BL-392 subject-bound-04
  Scenario: an empty briefing yields a date-only subject
    Given a briefing whose content is empty
    When the briefing email subject is built
    Then the subject names the briefing date with no trailing headline separator
