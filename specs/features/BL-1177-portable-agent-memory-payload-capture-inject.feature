Feature: portable agent-memory payload capture and inject for same-role swap

  # BL-1177 (epic BL-1176). Define schema-versioned portable memory and
  # capture/inject API. Prefer portable artifacts over vendor session blobs.

  Background:
    Given a same-role model swap needs transferable agent memory

  # BL-1177 capture-emits-versioned-payload-01
  Scenario: capture emits a schema-versioned portable payload for a role
    Given outgoing agent state for role "coder" with open parcel context
    When memory is captured for that role
    Then a portable payload is produced with a schema version
    And the payload carries open parcel context and a continuity summary

  # BL-1177 inject-restores-named-fields-02
  Scenario: inject restores named continuity fields into the incoming agent
    Given a valid portable memory payload for role "coder"
    When memory is injected for that role before live work
    Then the incoming agent receives the open parcel context from the payload
    And the continuity summary is available to the incoming agent

  # BL-1177 inject-fails-closed-03
  Scenario Outline: inject fails closed on missing or malformed payload
    Given the portable memory payload is <bad>
    When memory inject is attempted for a role
    Then inject refuses with a clear signal
    And continuity is not silently pretended

    Examples:
      | bad        |
      | missing    |
      | malformed  |

  # BL-1177 pure-capture-fixtures-04
  Scenario: capture aggregation is pure over named fixture inputs
    Given fixture inputs for transcript summary and open parcel ids
    When capture runs in memory without a live agent
    Then the payload fields match the fixture inputs
