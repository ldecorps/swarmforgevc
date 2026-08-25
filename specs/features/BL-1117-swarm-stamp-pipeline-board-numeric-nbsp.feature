Feature: BL-1117 stamp-off of Pipeline Board numeric nbsp tip 646ffe85d
  Commit 646ffe85d lands on local main and makes Pipeline Board HTML emit
  the numeric entity &#160; for U+00A0 instead of the named entity &nbsp;,
  which Telegram HTML parse_mode does not accept as a named entity.

  This ticket stamps that tip off — confirm or refute, do not reimplement.
  A human certifies or waives via Approvals and the hotfix ledger; green
  tests alone never certify.

  # BL-1117 escape-html-numeric-nbsp-01
  Scenario: escapeHtml emits numeric &#160; for U+00A0 and never named &nbsp;
    Given a Pipeline Board stage header string that contains a U+00A0 between DC and QA
    When escapeHtml renders that string for Telegram HTML parse_mode
    Then the output contains the numeric entity ampersand-hash-160-semicolon
    And the output does not contain the named entity string &nbsp;

  # BL-1117 stage-header-keeps-phone-line-02
  Scenario: Pipeline Board stage header keeps DC and QA on one phone line marker
    Given a rendered Pipeline Board HTML body with the DC and QA stage labels
    When the stage header markup is inspected
    Then DC and QA are separated by the numeric nbsp entity
