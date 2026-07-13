# BL-353 retire-legacy-telegram-narrator — 20260713 (coder)

## The load-bearing finding, per signal (determined from code, before anything was built)

| Signal | Concierge coverage BEFORE this ticket | Action taken |
|---|---|---|
| gate-needs-you | **Covered**, for a gate whose role holds a resolvable ticket — `swarmEventStream.ts`'s `diffNeedsApproval` fires off the SAME `computeRoleGateStatesLive` the legacy narrator read, and a reply routes back through `bl-topic-approval-sweep!` → `operator-decide.js approve` → `answerCapturedGateLive`, the identical write path the legacy relay used. | No change — verified unchanged, re-checked with a real fixture below. |
| dead-letter | **Not covered** — `handoffd.bb`'s `:log-dead-letter!` adapter only ever wrote a log line; `swarmEventStream.ts`'s `SwarmEventType` has no dead-letter member. | **Ported** (new `notify-dead-letters.js` CLI). |
| pr-link | **Not covered**, and the underlying `prUrl` is produced in exactly ONE place in the whole codebase — `swarmforge.openPR` (a VS Code command; `gh pr create` never runs anywhere else, confirmed by a repo-wide grep). | **Ported** (announced directly from `openPR`'s own success path). |
| stage-transition | **Not covered at the same granularity** — Concierge only has `TaskStarted`/`TaskCompleted` (ticket-lifecycle checkpoints), not the legacy narrator's per-role active/idle flip stream. | **Determined functionally covered by the combination** of `TaskStarted`+`TaskCompleted`+`NeedsApproval`+BL-349's stuck-escalation email — not ported as new per-role machinery. See reasoning below. |

## Why dead-letter and PR-link were NOT modeled as new `SwarmEventType` members

`swarmEventStream.ts`'s own `SwarmEvent` interface requires a real `backlogId: string` (non-optional), and its header comment is explicit: this module must never import `notify/telegram*` code, and every event is fundamentally per-ticket. Neither signal fits that shape cleanly:

- A dead-lettered handoff's only reliable field is the ROLE whose inbox it sat in — its own free-text `task` header field is not guaranteed to be a real `BL-###` id (unlike a live gate, which resolves through the SAME `roleTicket` map `NeedsApproval` already trusts). Forcing a fuzzy task→backlogId guess would be fragile in exactly the way this ticket exists to avoid (a silently-wrong or silently-dropped alert).
- A PR is not reliably scoped to one ticket at all (a batch of merged work can span several).

Both are genuinely **swarm-wide**, not per-ticket, signals. BL-346 (this same session) already built exactly the right home for that: the reserved Operator forum topic (`OPERATOR_SUBJECT_ID`, bound once via `ensureOperatorTopic`). Both ported signals announce into it, reusing existing infrastructure rather than inventing new per-ticket-topic-routing machinery for a swarm-wide concern (`swarmEventStream.ts` itself was left completely untouched).

## dead-letter: `notify-dead-letters.js` (new CLI + `deadLetterNotifier.ts`)

Growing-set semantics, not id-set-replace like `recertBatchNotifier.ts` (BL-339): a dead-lettered file never automatically "un-dead-letters" itself, so the durable `.swarmforge/operator/dead-letter-notify-state.json` only ever grows — a file, once announced, is never re-announced, but a genuinely NEW dead-letter (even while old ones remain unhandled) is. Armed only on confirmed delivery (BL-345's own lesson, reapplied a third time this session). Reuses `listDeadLetters`/`buildRoleInboxes` — the exact scan the legacy narrator itself used — so the port can never disagree with what actually got dead-lettered. Wired into `handoffd.bb`'s existing chase-sweep cadence as `dead-letter-notify-sweep!`, the same shape as `recert-notify-sweep!` (BL-339) and the sibling sweeps before it.

## PR-link: `announcePrLinkOnTelegram` (new helper in `extension.ts`, called from `openPR`)

Since `gh pr create` only ever runs from inside the `swarmforge.openPR` VS Code command (confirmed: no headless caller exists anywhere, and building one is explicitly out of this ticket's scope), there is nothing to *poll* for headlessly — the notification is sent synchronously, in the SAME command handler, the moment the PR is actually created. This is not "headless" in the sense of running without VS Code (it structurally cannot be, since PR creation itself requires the extension host), but it no longer depends on the retired narrator's own polling infrastructure, and reuses the SAME `resolveTelegramBotToken`/`resolveTelegramChatId` VS Code secret resolvers (general credential resolvers, not narrator-specific — kept, along with their four set/clear commands). Degrades silently (never throws) if Telegram is not configured or the Operator topic does not exist yet — opening the PR itself must never fail over this.

## stage-transition: why this was NOT ported as new per-role machinery

The legacy `diffStageTransitions` fired on every role's `pipeline[].status` active/idle flip — a fine-grained, high-frequency signal. Reading its real purpose: it exists so the human can tell a ticket is progressing and no role is silently doing nothing. Three things already headlessly cover the actual information value:

1. `TaskStarted`/`TaskCompleted` (existing) narrate the ticket's own material lifecycle boundaries into its BL-topic.
2. `NeedsApproval` (existing) narrates the moment a role needs the human.
3. **BL-349's stuck-escalation email** (shipped this SAME session) now closes the highest-value case the legacy signal would have caught — a role silently stuck with no progress — via a real headless email, independent of any topic/narration mechanism at all.

Building a full per-role active/idle BL-topic-posting stream would be substantial NEW Concierge architecture (a new event type, new derive logic, a new per-tick data source), and the ticket's own scope explicitly excludes "the Concierge system's own behavior beyond carrying any ported signal." Given the combination above already answers "is this ticket moving, and will I be told if it silently isn't", a byte-for-byte porting of the legacy signal's granularity was judged not worth the new surface area. This is a stated, evidence-backed finding per the ticket's own instruction to "state the finding explicitly" — not an oversight.

## gate-needs-you / blocked-role-answer: a known, PRE-EXISTING, shared limitation (not introduced here)

`diffNeedsApproval` drops a gate when the gated role holds no resolvable ticket (`roleTicket[role]` empty) — the legacy narrator had no such restriction. In practice this is a narrow edge (a task-mode role is gated almost exclusively while holding real in-process work, which is precisely what populates `roleTicket`), and it predates this ticket entirely (BL-297/298's own original scope, not something BL-353 introduces or worsens). Closing it would require a reply-routing mechanism distinct from BL-346's reserved Operator topic (whose own inbound replies already go to the restricted Operator's conversation, not a gate-answer flow) — a genuinely separate feature. Documented here rather than silently left for a future coder to rediscover; a narrower follow-up ticket would be the right vehicle if the human wants it closed, matching this project's own established precedent (see BL-318/BL-325's own rule_proposal-not-bounce calls for comparably narrow residual gaps).

## What was deleted

- `extension/src/notify/telegramNarrator.ts`, `telegramInboundRelay.ts`, `telegramNarrationSnapshot.ts`
- Their four test files (`telegramNarrator.test.js`, `telegramInboundRelay.test.js`, `telegramNarrationSnapshot.test.js`, `telegramAdapterComposition.test.js`)
- `specs/features/BL-239-telegram-chat-adapter.feature` + `specs/pipeline/steps/telegramAdapterSteps.js` (its own acceptance surface, now retired alongside the code it tested)
- `extension.ts`: `startOrRestartTelegramAdapter`, `stopTelegramAdapter`, the narration/inbound `setInterval` polling loops, module-level interval/output-channel state, the `TELEGRAM_*_POLL_INTERVAL_MS`/`TELEGRAM_RETRY_CONFIG` constants, and **every** call site (8 total — 3 more than the ticket's own source enumerated: `swarmforge.launchSwarm`'s success handler, plus the two secret-clear commands' `stopTelegramAdapter()` calls, found by an exhaustive grep rather than trusting the ticket's own partial list).

**One real dependency found and preserved, not deleted along with the file it lived in**: `nextUpdateOffset` (a small pure getUpdates-offset utility) is genuinely used by the REAL, live, headless front-desk bot's own poll loop (`telegram-front-desk-bot.ts`), unrelated to the legacy `TelegramInboundRelay` class it happened to sit next to. Moved it into `telegramFrontDeskBotCore.ts` (the front-desk bot's own pure/testable-core module) along with its 2 tests, before deleting `telegramInboundRelay.ts` — confirmed via a repo-wide grep before deleting anything, not assumed from the file's name.

**Kept, deliberately**: `swarmforge.setTelegramBotToken`/`clearTelegramBotToken`/`setTelegramChatId`/`clearTelegramChatId` — general credential-management commands, still consumed by `announcePrLinkOnTelegram` and (via env vars, not VS Code secrets) by the real headless front-desk bot process. Only their `stopTelegramAdapter()` side-effect calls were removed.

## Test coverage

- `extension/test/deadLetterNotifier.test.js` (new) — the growing-set decision function and message formatting, pure.
- `extension/test/notifyDeadLettersCli.test.js` (new) — real git-fixture, real compiled-CLI coverage: a new dead letter is announced into the reserved Operator topic, the same one is never re-announced, no dead letters means no announcement, no crash/no arm when the Operator topic does not exist yet, missing Telegram config never arms, a failed send stays unarmed and retries, and a genuinely new second dead letter after the first is announced again.
- `swarmforge/scripts/test/test_handoffd_dead_letter_notify_wiring.sh` (new) — proves the real daemon's poll loop reaches `dead-letter-notify-sweep!`, invokes the compiled CLI at the right path with `cwd=project-root`, surfaces its stdout into the daemon log, repeats on the shared cadence, and never throws — the same "stub the compiled JS entry point" technique `test_handoffd_recert_notify_wiring.sh` (BL-339) already established.
- `extension/test/telegramFrontDeskBotCore.test.js` — gained `nextUpdateOffset`'s 2 moved tests; unaffected otherwise.
- `specs/pipeline/steps/retireLegacyTelegramNarratorSteps.js` (new, registered in `specs/pipeline/steps/index.js`) — all 5 Gherkin scenarios in `BL-353-retire-legacy-telegram-narrator.feature`:
  - 01/02 drive real per-signal checks (a pure `deriveSwarmEvents` fixture for gate-needs-you; the real compiled dead-letter CLI; source-verified wiring for PR-link and the stage-transition combination — the same "verify from real source" posture BL-336's own audit used for `vscode.*`-gated code it could not headlessly invoke either).
  - 03 drives the real `handleApprovalDecisionForTicket` (pure, adapter-injected, unchanged by this ticket) with fake adapters, confirming the gate-answer chain that now solely carries this responsibility still resolves and answers the right role.
  - 04 verifies the legacy files are gone and `extension.ts` no longer references any of the retired names.
  - 05 drives the real dead-letter CLI twice against the same fixture, confirming exactly one send.

Full regression: `npx vitest run` in `extension/` — 232 test files (down from 234: −4 deleted, +2 new), 3238 tests, all green. Re-ran every Telegram/topic acceptance feature this ticket's changes touch or could plausibly affect
(BL-346, BL-339, BL-281, BL-294, BL-297, BL-298, BL-300, BL-325) — all green. Re-ran the dependency-gate CLI's own real ruleset check (`dependencyGateCli.test.js`) to confirm `extension.ts` importing from `./tools/telegram-front-desk-bot`/`./tools/telegramFrontDeskBotCore` (a new cross-layer import this ticket introduces) violates no architecture boundary — green.

## What was explicitly not done

No real Telegram network call anywhere in any test (`TELEGRAM_NOTIFY_FORCE_RESULT` throughout, mirroring BL-339/BL-345's own established seam). The untagged-gate limitation (above) was documented, not closed — a conscious, evidence-backed scope decision, not an oversight. No new headless PR-creation mechanism was built (explicitly out of scope; the port only carries whatever `openPR` itself already produces). `package.json`'s command contributions were not touched — all four Telegram credential commands remain registered and functional.
