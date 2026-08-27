Feature: the paused pager screen shows the server's failure reason, not a bare HTTP status

  # BL-662: pausedPagerUiHtml.ts's non-OK response branch renders
  # "<failText> (HTTP <status>)" and discards the response body, even though
  # the bridge sends a JSON `reason` on failure (e.g. "ticket not found in
  # active/paused" on 404) and the OK-but-unsuccessful branch right below
  # already displays payload.reason. Fix reads the body first on the non-OK
  # branch and prefers its reason, falling back to failText + status only
  # when the body has none or fails to parse — matching BL-572's
  # bounce-#3 fix to the epic reorder screen. The invariant covers every
  # response path of this screen, not just the one named line.

  # BL-662 non-ok-response-with-reason-shows-reason-01
  Scenario: a non-OK response carrying a reason shows that reason, not a bare status code
    Given the bridge responds to a paused-pager action with a non-OK status and a JSON body containing "reason": "ticket not found in active/paused"
    When the paused pager renders the response
    Then the status line shows "ticket not found in active/paused"
    And the status line does not show a bare "HTTP 404" with no reason text

  # BL-662 non-ok-response-without-reason-falls-back-02
  Scenario: a non-OK response with no reason falls back to failText plus status
    Given the bridge responds to a paused-pager action with a non-OK status and a body containing no "reason" field
    When the paused pager renders the response
    Then the status line shows the configured failText followed by the HTTP status

  # BL-662 non-ok-response-with-unparseable-body-falls-back-03
  Scenario: a non-OK response whose body fails to parse falls back to failText plus status
    Given the bridge responds to a paused-pager action with a non-OK status and a body that fails to parse as JSON
    When the paused pager renders the response
    Then the status line shows the configured failText followed by the HTTP status

  # BL-662 every-status-line-writer-in-the-file-covered-04
  Scenario Outline: every status-line writer in pausedPagerUiHtml.ts prefers a server-sent reason
    Given "<action>" responds non-OK with a JSON body containing a reason
    When the paused pager renders the response for "<action>"
    Then the status line shows the server-sent reason

    Examples:
      | action    |
      | expedite  |
      | approve   |
