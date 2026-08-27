Feature: read-stage-skip-reasons parses the flow-style mapping every live ticket actually uses

  # BL-661: required_stages_lib.bb's read-stage-skip-reasons recognizes only
  # a BLOCK-style stage_skip_reasons mapping, but backlog-schema.md's own
  # example and all seven live tickets carrying the field use FLOW style
  # (`stage_skip_reasons: { cleaner: "reason", ... }`) — so the reader
  # returns {} for every declared reason and swarm_handoff.bb's routing
  # audit record never carries the committed justification, even though
  # routing itself (resolve-effective) is unaffected. Fix teaches the reader
  # to also parse the flow mapping, keeping block-style support for free.

  # BL-661 flow-style-mapping-is-read-01
  Scenario: a flow-style stage_skip_reasons mapping is read correctly
    Given a ticket YAML declares stage_skip_reasons as a flow mapping on the header line
    When read-stage-skip-reasons parses it
    Then it returns every declared stage and its reason, not an empty map

  # BL-661 block-style-support-unchanged-02
  Scenario: block-style stage_skip_reasons mappings still parse as before
    Given a ticket YAML declares stage_skip_reasons as an indented block mapping
    When read-stage-skip-reasons parses it
    Then it returns every declared stage and its reason, unchanged from before this fix

  # BL-661 quoted-reason-with-comma-and-braces-03
  Scenario: a flow-style reason containing a comma and braces parses without truncation
    Given a ticket YAML declares a flow-style stage_skip_reasons entry whose quoted reason contains a comma and brace characters
    When read-stage-skip-reasons parses it
    Then the full reason text is returned unaltered, not truncated at the comma or brace

  # BL-661 stage-keys-still-normalize-04
  Scenario: stage keys in a flow-style mapping still normalize through normalize-token
    Given a flow-style stage_skip_reasons entry uses the "hardener" alias for the "hardender" stage
    When read-stage-skip-reasons parses it
    Then the reason is keyed under the normalized stage name

  # BL-661 skip-trail-record-carries-the-reason-05
  Scenario: the routing skip-trail audit record carries a flow-style reason end to end
    Given a ticket declares a flow-style stage_skip_reasons entry for a skipped stage
    When swarm_handoff.bb builds the routing decision record for that skip
    Then the record's reasons field carries the declared reason text
