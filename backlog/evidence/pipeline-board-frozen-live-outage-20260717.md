# Pipeline board: live outage — post frozen since ~00:44 UTC (diagnosed 2026-07-17 ~11:20 UTC)

Operator-driven diagnosis. Not yet ticketed — routing directly as a priority live defect (board is
user-facing broken RIGHT NOW), distinct from the BL-474 audit follow-ups (BL-487/488/489), which are
about latent/architectural staleness, not this active outage.

## Symptom

The Telegram Pipeline Board message has not changed in 10+ hours. `.swarmforge/operator/concierge-tick-state.json`
`pipelineBoard.lastChangeMs` = 1784249050873 (2026-07-17 00:44:10 UTC) and its `contentSignature` still
shows BL-469/BL-423 — tickets that are no longer even in backlog/active/ or backlog/paused/. Confirmed
frozen by polling the state file twice, 35s apart: byte-identical.

In the SAME window, `approvalsRoster` in the SAME state file DID change content between polls (moved from
listing BL-486/487/488/489 pending to "No tickets are currently awaiting approval"). This proves:
  - the concierge tick loop is alive and running every cycle (not a process hang, not a swarm-wide outage)
  - the failure is ISOLATED to the pipeline board's own post path, not shared Telegram plumbing

## Root cause (traced in code, confirmed structurally — exact API error NOT captured, see below)

The board's post-to-Telegram path swallows every failure with NO logging anywhere:
  - `extension/src/notify/telegramClient.ts` `callTelegramApi`: catches a non-ok response into
    `{success:false, error: formatApiFailureError(...)}` — never calls console.error/console.log on it.
  - `extension/src/tools/telegram-front-desk-bot.ts` `boardAdapters.postMessage` (~L1917): maps the result
    to `r.success ? r.messageId : undefined` — the `error` string is discarded, never surfaced.
  - `extension/src/concierge/pipelineBoardSync.ts` `postBoardMessage`: sees `messageId === undefined`,
    returns `outcome: 'failed-post'` and leaves `prevState` (old topicId/messageId/contentSignature)
    otherwise untouched — so the NEXT tick recomputes a fresh contentSignature (since real backlog state
    differs), tries to post again, fails again, silently, forever. No cap, no backoff-then-alert, no log.

Ruled out:
  - Message length: rendered live via the CURRENT on-disk extension/out build against the CURRENT
    backlog/active + backlog/paused = 1573 chars plain / 1587 wrapped HTML. Nowhere near Telegram's 4096
    limit.
  - Token/network-wide outage: approvalsRoster (same bot token, same chat, posted via the same
    sendTelegramMessage/callTelegramApi path) updated successfully in the same window.
  - Supervisor crash-loop as the (sole) cause: front-desk-supervisor.log shows the bot restarting
    every ~10-15 min through the morning (05:23–10:07Z), but the CURRENT bot process (pid 726258,
    started 10:07Z log-time) has been continuously up since with NO further restart, and the board is
    STILL frozen during this stable window — so a bare restart is not expected to clear it on its own.
    (Also notable, adjacent evidence of a related class of silent Telegram-post failure: the log DOES
    carry plain-string failures like "front-desk bot: failed to close the approval ask for BL-491/493/494
    (message edit failed or not wired)" — that path at least logs a string; the board's post path doesn't
    even do that.)

Likely candidates for the underlying Telegram-side failure (unconfirmed — the real error text is never
logged, so this needs verification): the board's own Telegram topic (topicId 1634 in the frozen state) or
its last messageId may have gone stale/invalid (topic archived/deleted, or a delete/post race from
BL-462/BL-468's delete-then-post mechanism landing out of order), causing every retry to hit the same
rejected call.

## Recommended fix (minimal, fast)

1. Make the failure visible: log `result.error` (or the board-specific caller) on a `failed-post`/
   `failed-no-topic` outcome from `syncPipelineBoard` — one line is enough to see the real Telegram
   rejection reason on the very next tick.
2. Once the real error is visible, fix whatever it names (most likely: recreate the board topic / clear
   the stale topicId+messageId in TickState.pipelineBoard so `ensureBoardTopic`/a fresh post recovers,
   OR fix a delete/post ordering bug if that's what's failing).
3. Do NOT change the render/change-gate contract (BL-462/464/465/468/473's own posture) — this is a
   plumbing/observability defect in the post path, not a data or rendering defect.

## Priority

This is a live, user-facing outage (human directly asked "when can I get the pipeline board working
again?"), not a backlog nice-to-have — should be picked up ahead of routine paused-queue ordering.
