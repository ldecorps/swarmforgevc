Feature: BL-1152 stamp-off of Cursor hotfix 7380d80686
  Commit 7380d80686 is a human-landed hotfix already on local main with
  Hotfix-Certification: pending. It lets Approvals Yes/No taps for
  concurrent hotfix stamp asks resolve via hotfix-stamp-asks.json and
  hotfix_ledger_update, instead of depending on the single
  awaiting-answer.json slot.

  This ticket stamps that landed work off — confirm or refute, do not
  reimplement. A human certifies or waives via Approvals and the hotfix
  ledger; green tests alone never certify.

  # BL-1152 hotfix-stamp-asks-resolve-01
  Scenario: resolveAskOptions reads options from hotfix-stamp-asks.json for hotfix- threads
    Given the source of extension/src/tools/telegram-front-desk-bot.ts at commit 7380d80686
    And a hotfix-stamp-asks.json entry keyed by threadId "hotfix-<commit>"
    When resolveAskOptions is called with that threadId
    Then it returns that entry's options
    And it does not require awaiting-answer.json to match the threadId

  # BL-1152 hotfix-stamp-answer-decides-ledger-02
  Scenario: Approvals Yes/No on a hotfix- subject decides the ledger without the bridge
    Given the source of extension/src/tools/telegram-front-desk-bot.ts at commit 7380d80686
    When a poll answer is posted for subjectId "hotfix-<commit>" with label Yes or No
    Then applyHotfixStampAnswer runs hotfix_ledger_update --decide for that commit
    And the answer is not forwarded to the bridge as an ordinary ask reply

  # BL-1152 ordinary-asks-unchanged-03
  Scenario: Non-hotfix thread ids still use the single awaiting-answer slot
    Given the source of extension/src/tools/telegram-front-desk-bot.ts at commit 7380d80686
    When resolveAskOptions is called with a non-hotfix threadId
    Then it still resolves options from awaiting-answer.json when the thread matches
    And postToBridge is used for non-hotfix subject ids
