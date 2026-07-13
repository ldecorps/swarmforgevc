# BL-353 retire-legacy-telegram-narrator — architect review (20260713)

Merged cleaner cba58cf7ba (on top of coder b00ed7ea, merge-base 9b7ce40619).

## Hard gate (BL-259)
`node extension/out/tools/dependency-gate.js` against all changed/new source
files (`extension.ts`, `deadLetterNotifier.ts`, `notify-dead-letters.ts`,
`notify-recert-batch.ts`, `telegram-front-desk-bot.ts`,
`telegramFrontDeskBotCore.ts`), after a clean `npm install && npm run compile`:
**PASSED — no forbidden edges.**

## Co-change (BL-255, informational)
`co-change-report.js` over the same file set: `extension.ts` shows its usual
broad historical coupling (a large `activate()` orchestrator touched by most
tickets — pre-existing, not introduced here). No new suspicious coupling for
the two new modules (`deadLetterNotifier.ts`, `notify-dead-letters.ts`); no
send-back warranted.

## Architecture checks
- Two-layer boundary (tiles=view, tmux=substrate): untouched by this ticket.
- Extension host owns I/O: `announcePrLinkOnTelegram` and the new CLI both
  live in extension-host/CLI code, not the webview — consistent.
- No webview storage: untouched.
- Secrets stay in extension-host env only: the ported PR-link path reuses the
  existing `resolveTelegramBotToken`/`resolveTelegramChatId` VS Code secret
  resolvers unchanged; the new headless dead-letter CLI reads
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` from `process.env`, the same
  convention the live front-desk bot process already uses — nothing written
  to the target working directory or a commit.
- Integrate-not-fork: `swarmforge/scripts/handoffd.bb`'s new
  `dead-letter-notify-sweep!` wiring is a local modification to this repo's
  own maintained fork (per `local-engineering.prompt`), matching the
  established `recert-notify-sweep!` (BL-339) pattern — not a change to an
  unmodified upstream dependency.
- CLI `main()` thin-wrapper rule: `notify-dead-letters.ts`'s `main()` is
  wiring only; the growing-set decision (`decideDeadLetterAnnouncement`) and
  message formatting (`buildDeadLetterAnnouncementText`) are pure, exported,
  and unit-tested directly in `deadLetterNotifier.test.js` — correct split.
- Arm-on-confirmed-delivery (BL-345's own lesson): `notify-dead-letters.ts`
  only persists `announcedFilePaths` after `result.success`, never on a bare
  send attempt — checked directly in the source, not eyeballed from the
  evidence file's own claim.

## Correctness spot-check
- Grepped `src/` and `test/` for every retired symbol
  (`startOrRestartTelegramAdapter`, `stopTelegramAdapter`, `TelegramNarrator`,
  `TelegramInboundRelay`, `telegramNarrationSnapshot`, the poll-interval
  constants) — zero live references remain, only two historical comments.
  Confirms acceptance scenario 04 ("the retired system no longer runs") is
  not just tested but actually true repo-wide.
- Full regression: `npx vitest run` in `extension/` — 232 files / 3260 tests,
  all green.
- Ran the real acceptance suite for this ticket's own feature file
  (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-353-retire-legacy-telegram-narrator.feature`) — all 5
  scenarios pass live, not just claimed in the evidence file.
- No functional-correctness defect spotted while reviewing (see architect
  rule on correctness send-backs) — the dead-letter/PR-link scope decisions
  and the untagged-gate limitation are documented, evidence-backed scope
  calls, not gaps introduced by this parcel.

## Verdict
PASS. Forwarding to hardener.
