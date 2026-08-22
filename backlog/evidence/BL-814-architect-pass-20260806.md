# BL-814 — architect pass

Reviewed commit: `5a95b3d02db6a78aca844144e90da2fc6427bb18` (received from
cleaner — a pure merge commit, no diff of its own; cleaner found nothing to
clean on top of coder's `d147e5c3c9`).
Parcel diff scope: `e3a894da..5a95b3d02d`, 9 files (2 source, 2 unit-test
files, 1 feature file renamed from `.draft`, 2 step-handler files touched/
added, 1 step-registry wiring line, 1 ticket yaml).

Result: **NONE — no defects found. Architecturally compliant.**

## Dependency-rule gate (REQUIRED HARD GATE, BL-259)

`node out/tools/dependency-gate.js src/concierge/conciergeTick.ts
src/tools/telegram-front-desk-bot.ts` reports the same 3 `acyclic`
violations already known from BL-811/BL-813 architect passes
(`telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts`). Confirmed **pre-existing and
unrelated** to this parcel:

- Reproduced on the pre-parcel baseline directly: ran the same full-repo
  scan from the QA worktree at `e3a894da` (my last-known-good commit before
  this parcel) — identical 3 edges reported there too.
- `git diff e3a894da 5a95b3d02d -- extension/src/tools/telegram-front-desk-bot.ts
  | grep '^import\|^+import\|^-import'` is empty — this parcel changed zero
  import statements in the one implicated file it touches (its diff is
  entirely inside function bodies: the new `RoleHeldTicketsComputationFailedError`
  class and the `syncBoardIfWired` catch block).
- Already tracked: `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`,
  which explicitly anticipates and rules against bouncing exactly this case
  ("the next parcel that touches any of these three files... a wasted
  round-trip charged to an innocent ticket").

Not a BL-814 send-back item.

## Co-change coupling (BL-255, informational)

`co-change-report.js` on the two changed source files reports the expected
tight coupling between `conciergeTick.ts` / `telegram-front-desk-bot.ts` and
their own test files / the concierge subsystem (pipelineBoard*.ts,
topicRouter.ts, etc.) — both directly touched here, and every top-ranked
co-changed file is either already part of this parcel or an established,
long-running sibling of this hot subsystem. Nothing surprising.

## Invariants review (BL-633/BL-654)

Both ticket-declared invariants carry real, non-vacuous coverage:

1. "A copy-real-scripts fixture whose dependency set is incomplete fails
   loudly; it never reports a passing-shaped empty result." — Scenario
   Outline 03 (3 examples: each of the fixture's three non-leaf
   dependencies deleted in turn) plus the mirrored unit-test loop in
   `readLiveRoleHeldTicketsCli.test.js`. Confirmed non-vacuous by reading
   the diff: the pre-existing tests for "CLI missing" and "garbage stdout"
   previously asserted `deepEqual(result, {})` and now assert
   `assert.rejects(..., RoleHeldTicketsComputationFailedError)` — a real,
   observable behavior flip, not a newly-added tautological check.
2. "readLiveRoleHeldTickets distinguishes 'no role holds a ticket' from
   'the computation did not run'." — Scenario 04 (genuinely-empty case)
   is kept unchanged and still asserts a bare empty map with no exception;
   Scenario 03 asserts the opposite shape (thrown error, no result value).
   Both directions are exercised, not just one.

## Property testing

No new or newly-touched pure, property-shaped module. The parcel's
production diff is subprocess-failure control flow (a try/catch around an
`execFileAsync` call and its caller's error handling) — not a round-trip,
conservation, idempotence, or ordering property candidate.
`invertTicketStageToRoleHeldTickets` (the one plausibly-pure helper in the
touched file) is untouched by this parcel's diff. No property test added;
none needed.

## Correctness read

`syncBoardIfWired`'s new catch-and-return-`{ state: prevBoard }` path
mirrors the existing early-return immediately above it (the
`!boardAdapters || !readRoleHeldTickets` guard) byte-for-byte in shape —
same return type, `outcome` left `undefined` in both cases, and the sole
call site (`runConciergeTick`) only reads `boardSync.state`, never branches
on `outcome` being present. No divergent behavior introduced.

## Verification run myself

- `npm run compile` — clean.
- `npx vitest run test/readLiveRoleHeldTicketsCli.test.js
  test/conciergeTick.test.js` — 119/119 pass (2 files).
- `node specs/pipeline/cli.js
  specs/features/BL-814-live-role-held-fixture-loud-degrade.feature` —
  6/6 scenarios pass.
- `node specs/pipeline/cli.js
  specs/features/BL-487-board-freshness-without-coordinator-sync.feature`
  (sibling feature sharing the same copy-real-scripts fixture technique,
  whose own copy list the coder also updated) — 2/2 pass.

## Architecture checklist (this project's rules)

- Two-layer boundary (tiles/webview view vs. tmux substrate): not
  touched — this parcel is entirely in the concierge/Telegram-bot
  subprocess-adapter layer, no webview or tmux code.
- Extension-host I/O ownership: unchanged — `readLiveRoleHeldTickets`
  remains the extension host's own subprocess call; the webview is not
  involved.
- Webview storage / secrets: not applicable, no webview or secret-handling
  code touched.
- Integrate-not-fork: not applicable — SwarmForge core (`.bb` scripts)
  untouched; only the copy-fixture list and the TS adapter's error handling
  changed.
- Dependency direction: clean for this parcel's own edges (see gate above).

No correctness defects spotted. Forwarding to hardener.
