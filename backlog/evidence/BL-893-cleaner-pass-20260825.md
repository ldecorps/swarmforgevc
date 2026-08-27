# BL-893 — cleaner pass — 20260825

- Tip-pure rebuild: `origin/main` + cherry-pick coder `2b13bf03ab`
  (ff impossible — tip parent was pre-BL-1140 QA). `dels_on_origin=0`.
- DRY: shared `engageApprovalsAmbulanceHold` for Approvals slash + button
  paths in `telegramFrontDeskBotCore.ts`.
- vitest: pendingApprovalReply, telegramFrontDeskBotCore,
  conciergeTopicRouting, conciergeTick — 697/697 pass (after `tsc`).

By cleaner.
