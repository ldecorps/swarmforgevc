Feature: BL-895 the BL-607 paragraph appears once in Specification.MD

  Commit 7fa17fecd meant to document BL-607 in the reference specification
  once. It inserted the same paragraph 286 times instead, each preceded by a
  blank line, taking the file from 503KB to 1,336KB in that single commit and
  interleaving prose between the bullets of lists that now read as shredded.
  It has ridden every commit since, unnoticed for three weeks. 284 of the
  copies are also textually corrupt: their role_ask options example lost its
  JSON quoting, so the file documents an invalid command form far more often
  than the valid one.

  Background:
    Given the reference specification docs/reference/Specification.MD

  # BL-895 spec-md-bl607-duplicate-01
  Scenario: the BL-607 clarifying-questions paragraph appears exactly once
    When the specification is read
    Then the BL-607 clarifying-questions paragraph occurs exactly once

  # BL-895 spec-md-bl607-duplicate-02
  Scenario: the surviving copy documents the valid role_ask options form
    When the specification is read
    Then the surviving BL-607 paragraph shows the single-quoted JSON options argument
    And the corrupted unquoted options argument appears nowhere in the specification

  # BL-895 spec-md-bl607-duplicate-03
  Scenario: the surviving copy keeps its place in the chat adapter section
    When the specification is read
    Then the surviving BL-607 paragraph sits under the chat adapter heading
    And it sits between the BL-354 pending-question paragraph and the BL-708 relay paragraph

  # BL-895 spec-md-bl607-duplicate-04
  Scenario: the lists the duplication shredded are contiguous again
    When the specification is read
    Then no bullet list has a body paragraph interleaved between its items
