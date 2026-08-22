# BL-1036 architect pass — 2026-08-22

**Parcel:** cleaner forward `16a2bdac7e` ("Merge coder BL-1036 into
cleaner"), merged into architect at `064c2e5ec`. The only new content
commit is the coder's own `4c334f349` ("BL-1036: a front-desk restart
releases its poll slot, and the log closes what it opens"); cleaner
forwarded as-is, no changes of its own.

**Merge note:** this merge's common ancestor (`0543e3874b`) predates my
earlier BL-1041 architect bounce-and-revert, so cleaner's branch still
carried BL-1041's now-reverted files (`rescue_lib.bb`,
`rescue_orphaned_work.bb`, their tests, and the BL-1041 step handler) as
unrelated history. `specs/pipeline/steps/index.js` conflicted (my side had
already dropped the BL-1041 require line; their side added BL-1041's
alongside BL-1036's new one) — resolved by keeping BL-1035 + BL-1036 and
dropping BL-1041's, matching my revert. Confirmed post-merge: none of the
BL-1041 files reappeared (`ls` on all three: absent). Diffed the merge
against both parents: P1 diff is BL-1036's own additive work; P2 diff shows
only the expected BL-1041 deletions plus my own prior evidence files —
nothing else silently dropped either direction. A pre-commit gate also
required naming BL-1043 in the message for a `paused/ → hold/` rename that
rode in from upstream history (coordinator's own deliberate park,
`97f822dd5`) — not something this merge did itself, named per the gate's
requirement.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation attributable to this parcel, no invariant
violation, no correctness defect found. One pre-existing, already-ticketed
dependency-gate finding is out of scope (below), matching established
precedent.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary:** N/A concerns — this is
  extension-host `.ts` code (Telegram HTTP client + the front-desk bot's
  poll loop), standard `fetch`/`AbortController`, no VS Code webview or
  API surface touched.
- **Root cause genuinely confirmed, not assumed** (the ticket's own
  requirement): read the pre-BL-1036 code directly — no signal handler
  installed anywhere, `defaultPost` called `fetch` with no `signal`, so
  SIGTERM killed the bot mid-long-poll with the connection still open and
  Telegram held the slot server-side. This refutes the intake's leading
  remedy (a longer `FRONT_DESK_KILL_GRACE_MS`): the child dies instantly on
  SIGTERM either way, so a longer grace window could never have helped
  — confirmed by reading `make-kill-pid!`'s use, unchanged by this ticket.
- **REQUIRED HARD GATE — dependency-gate:** ran
  `node extension/out/tools/dependency-gate.js src/notify/telegramClient.ts
  src/tools/telegram-front-desk-bot.ts src/tools/telegramFrontDeskBotCore.ts`
  → **FAILED**, reporting an `acyclic` cycle among
  `telegram-front-desk-bot.ts`, `telegramCursorOperatorExec.ts`, and
  `telegramCursorOperatorLiveness.ts`. Investigated rather than waved
  through or bounced reflexively:
  - Confirmed BL-1036's own diff adds/removes zero import lines in
    `telegram-front-desk-bot.ts` (`git diff` between the parent and coder's
    commit, filtered for `import`: no hits) — the cycle is not introduced
    by this parcel.
  - Confirmed the specific two dynamic `await import(...)` call sites
    implicated already existed in the PARENT commit
    (`900d96507:extension/src/tools/telegram-front-desk-bot.ts`), before
    BL-1036 touched the file.
  - Found this is **already BL-759** ("The Cursor-operator modules import
    back out of the front-desk bot..."), a `medium`-severity defect minted
    2026-07-31 from a prior architect's own note, currently sitting in
    `backlog/paused/`. Its own recorded reproduction from a clean `main`
    lists the **exact same three edges**, verbatim. Its own text records
    that this same situation — an unrelated parcel's dependency-gate run
    surfacing this cycle — was "correctly ruled out of that parcel's
    scope" during the BL-723 pilot review. Same disposition applies here:
    out of scope for BL-1036, already owned, already graded, not
    re-litigated or re-bounced under a different ticket.
- **Co-change (BL-255):** ran `node extension/out/tools/co-change-report.js`
  over all three changed files. Large suspected-coupling lists for
  `telegramClient.ts`/`telegramFrontDeskBotCore.ts` reflect their own size
  and central role in the front-desk/notify subsystem (many legitimate
  sibling tests and concierge modules) — same shape as previously-reviewed
  large files in this codebase, nothing surprising or unaccounted for.
- **Declared invariant 1** ("never leaves two holders of the bot token
  polling at once"): `signal?: AbortSignal` threaded through
  `TelegramPostFn -> callTelegramApi -> getTelegramUpdates`, added LAST in
  every signature so every existing caller/test double is unaffected
  (confirmed: default parameter, backward compatible). One
  `AbortController` per poll cycle (never a single long-lived one, which
  would disable every later poll after the first abort) —
  `installPollShutdownHandlers` only wired at the CLI entry point
  (`require.main === module`), matching the module-load-is-pure-requires
  convention. Independently verified non-vacuity by hand: swapped the
  `abort()`/`onShutdown()` call order in a scratch edit of the real source,
  recompiled, re-ran the property test live — **invariant 1 test failed
  exactly as claimed** (`'exit' !== 'abort'`), invariant 2 stayed green.
  Restored and recompiled clean.
- **Declared invariant 2** ("every degraded-poll report is eventually
  followed by a recovery or unresolved report"): `shouldRaisePollRecoveredNotice`
  and `shouldRaisePollUnresolvedNotice` each fire exactly once per episode,
  derived from existing state (`consecutiveFailures`, `outage.escalate`)
  rather than a new flag — checked `outage.escalate`'s own edge-triggered
  definition (`!state.escalated && outageMs >= thresholdMs`, `escalated:
  state.escalated || escalate`) by hand to confirm the call site's
  `alreadyReported: false` hardcoding is safe (escalate can only be true on
  the one cycle it first crosses the threshold). Independently verified
  non-vacuity by hand: made `shouldRaisePollRecoveredNotice` return `false`
  unconditionally in a scratch edit of the real source, recompiled, re-ran
  the property test live — **invariant 2 test failed on the very first
  generated run** exactly as claimed, invariant 1 stayed green. Restored
  and recompiled clean.
- **Correctness read, by hand:**
  - `abortInFlightPoll`'s `inFlightPoll?.abort()` is safe when called before
    any cycle has run (`inFlightPoll` still `undefined`) and safe when
    called against an already-completed cycle's stale controller (abort
    after completion is a no-op per the AbortController/fetch contract) —
    no crash, no double-abort hazard.
  - `describePollConflictWindow` only fires on a message containing `'409'`
    and replaces Telegram's own misleading "make sure that only one bot
    instance is running" framing with the correct one (our own predecessor,
    bounded by the poll timeout) — checked against the actual 409 message
    text quoted in the ticket, matches.
  - Single-threaded ordering: `getUpdates`'s per-cycle
    `inFlightPoll = new AbortController()` assignment and the signal
    handler's synchronous `abort()` call cannot interleave mid-assignment
    in Node's execution model — no race window.
- **`required_wiring`:** none declared (ticket states why: every call site
  already exists, only behavior changed) — confirmed accurate, nothing to
  check.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

Both touched pure decision points (`shouldRaisePollRecoveredNotice`/
`shouldRaisePollUnresolvedNotice`'s sequencing, and the abort-before-exit
ordering) are already the direct subject of the two declared invariants,
tested as a SEQUENCE property rather than per-cycle — the right shape,
since the original defect was invisible at the single-cycle level.
`describePollConflictWindow` is a simple conditional formatter with full
branch coverage from the 13 unit tests; no round-trip/idempotence/ordering
candidate beyond what is already asserted. Nothing to add.

## Verification re-run live (not trusted from the commit message)

- `npx vitest run --config vitest.properties.config.mjs bl1036RestartConflictWindow.property.test.js`
  → **2/2, ALL PASS**.
- `npx vitest run bl1036RestartConflictWindow.test.js` → **13/13**.
- `npx vitest run telegramFrontDeskBotCore.test.js` → **409/409** (sibling
  suite, exact match to the commit's claim).
- `node specs/pipeline/cli.js specs/features/BL-1036-a-restart-does-not-cost-a-telegram-conflict-window.feature`
  → **5/5**.
- `npm run compile` (tsc -p ./) → clean throughout, including after each
  scratch break-and-restore cycle.

## What was NOT re-litigated

- qa_e2e step 5 (a live restart against real Telegram, confirming no 409
  in the supervisor log) is explicitly and correctly left outstanding by
  the coder — server-side conflict-window state cannot be established by
  any fixture. Not this pass's job to attempt either.
- BL-759 (the pre-existing `acyclic` cycle) — see above; already owned,
  already graded, not this ticket's scope.

— By architect.
