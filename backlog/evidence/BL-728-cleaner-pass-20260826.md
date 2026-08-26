# BL-728 — cleaner pass — 20260826

- merge_and_process coder tip `c6eb76cc85` (conflict in
  `extension/test/residentSpyUiHtml.test.js`: kept BL-1153 reload test
  alongside cleaner-branch BL-1046 tile assertions).
- DRY: `assertNoBabashkaParseFailure`, `oneShotSucceeded`, and
  `readBl728Evidence` in `bl728HandoffdDeliverParenVerificationSteps.js`.
- Verified: `test_handoffd_one_shot_flags_parse.sh` ALL PASS; BL-728
  acceptance feature 7/7 green.

By cleaner.
