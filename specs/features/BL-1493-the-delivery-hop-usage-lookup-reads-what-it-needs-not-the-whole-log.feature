Feature: BL-1493 the delivery hop's usage lookup reads what it needs, never the whole log

  Before every wake, deliver! stamps an llm_invocation record for the
  recipient by reading the whole context-events.jsonl to find that role's
  latest turn. On 2026-09-08 the file was 67 MB and 258 157 rows and one
  lookup cost 3.1 s, a third of each ~9 s delivery. The lookup reads from the
  tail and stops at the role's latest row or a bounded window.

  Background:
    Given a context-events log of 200000 rows whose byte reads are counted

  # BL-1493 usage-lookup-bounded-01
  Scenario: a role whose latest row is near the tail is found without reading the whole log
    Given the latest row for role "cleaner" is 50 rows from the end
    When the delivery hop looks up the latest usage for "cleaner"
    Then the result equals the answer a full read of the log gives
    And fewer than 5 percent of the log's bytes were read

  # BL-1493 usage-lookup-bounded-02
  Scenario: a role with no row in the window yields nil, as an absent log does
    When the delivery hop looks up the latest usage for "nobody"
    Then the result is nil

  # BL-1493 usage-lookup-bounded-03
  Scenario: a torn tail of NUL bytes does not hide the latest intact row
    Given the log ends in 4096 NUL bytes after the latest row for role "cleaner"
    When the delivery hop looks up the latest usage for "cleaner"
    Then the result equals the answer a full read of the log gives
