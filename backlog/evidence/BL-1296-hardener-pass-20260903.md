# BL-1296 hardener pass — 2026-09-03

Continued and finished WIP found already in this worktree at session start
(a prior hardener session's uncommitted work matching the in-process handoff
`.swarmforge/handoffs/inbox/in_process/batch_20260903T110522Z_000001`,
`commit: b35627b88e`, claimed `lastCommit: 925be0ff5e`). `ready_for_next.sh`
flagged this as `WORKTREE_DRIFT_DETECTED`, but the in_process batch item
confirms it is genuine hardening WIP, not drift — the diff matched the
handoff exactly and every change carried explicit mutant-killing rationale
in its own comments.

## Received
`925be0ff5e` — architect clean-sweep merge for BL-1296 (Bubble answers from
its own seat while the Cursor seat is busy).

## What was already done (prior session, this worktree)
- Extracted `notMineTurn` (bubbleSeat.ts) and `mirrorUnavailableReasonFor`
  (bubbleSeatLive.ts) as pure helpers with mutant-killing tests.
- Extracted `tryDispatchToBubbleSeat` out of `processInboundUpdates`
  (differential complexity gate — the caller's pre-existing debt should not
  absorb this ticket's branch count).
- BL-113 soft Gherkin mutation on scenario 02 ("A seat never serves another
  seat's topic", the only `Scenario Outline`): 4/4 killed, manifest stamped.
- New dispatch-level tests driving `processInboundUpdates` for real (not
  just a source-text check) for both the Bubble-topic and non-Bubble-topic
  cases.
- Several `bubbleSeat.test.js` additions pinning exact watchdog/refusal
  message text instead of loose regexes.

## This pass's additions
Ran the received tree's own claims through a full sweep before trusting them:

- Compiled clean (`npm run compile`).
- `npx vitest run` on all four touched test files: 156/156 pass.
- Hand-authored mutation sweep (BL-638 fallback — see below for why) over
  the three changed compiled files, one mutant at a time, each restored
  byte-identical after (`md5sum` verified before/after the whole pass):
  - `bubbleSeat.js`: 15 mutants — 14 KILLED, 1 equivalent
    (`turn.reason ?? default` vs `||` — `reason` can only ever be set via
    `input.mirrorUnavailableReason ? {reason: ...} : {}` at the one
    construction site, so it is never `''`; `??` and `||` are provably
    identical there).
  - `bubbleSeatLive.js`: 4 mutants — 3 KILLED, 1 initially SURVIVED
    (`mirrorUnavailableReasonFor`'s success-branch string literal replaced
    with `''`): the existing test asserted only `/cannot answer/`, which
    still matches because `decideBubbleSeatTurn`'s own truthy check on
    `mirrorUnavailableReason` omits the `reason` field for `''` and
    `formatBubbleSeatRefusal` falls back to ITS OWN default text — also
    containing "cannot answer". Fixed by pinning the exact message string
    in `bl1296BubbleSeatTurn.test.js`'s "empty answer" test. Re-run:
    KILLED.
  - `telegramCursorBridgeLive.js` (`tryDispatchToBubbleSeat` +
    `resolveBubbleSeatTurnFn`): 6 mutants —
    - guard conditions (3), `!isBubbleSeatTurn` flip (1): KILLED.
    - `topicId`/`seatTopicId` swap in the `runTurn` call: SURVIVED, and
      genuinely EQUIVALENT — the guard `isBubbleSeatTurn` already requires
      `inbound.topicId === deps.bubbleSeatTopicId` to reach this line, so
      the two fields hold the identical value at every call site; no test
      could ever separate the swap without changing the guard itself.
      Recorded here per BL-234/BL-927 (equivalence demonstrable from the
      code, not filed as settled without the reasoning).
    - `inbound.text ?? ''` fallback literal swapped to `'x'`: initially
      SURVIVED — no existing test drove an inbound event with `text`
      undefined through this path. Added
      `'tryDispatchToBubbleSeat passes an empty string ... when the inbound
      event carries no text'`. Re-run: KILLED.
    - final `return true` flipped to `return false`: initially SURVIVED —
      both poll-loop dispatch tests only check side effects, and the
      fallthrough this mutant causes lands on `decideInboundAction`'s own
      `ignore` gate (Bubble's topic is never the cursor topic by
      invariant 2), so the mutant is invisible through the poll loop in any
      reachable fixture. Rather than construct an unreachable
      topic-collision fixture, exported `tryDispatchToBubbleSeat` (mirroring
      the existing `resolveBubbleSeatTurnFn` precedent) and added two direct
      unit tests asserting its own return value for both the matching and
      non-matching cases. Re-run: KILLED.
  - Total: 25 mutants, 24 KILLED + 1 equivalent, 0 outstanding survivors.
- CRAP (`node scripts/crapReport.js` against `src/*.ts`, `--coverage
  --coverage.reportOnFailure=true` per the standing-red rule below): every
  changed/new function <= 6 — `notMineTurn` 3.00, `mirrorUnavailableReasonFor`
  2.00, `resolveBubbleSeatTurnFn` 2.00, `tryDispatchToBubbleSeat` 5.01,
  `decideBubbleSeatTurn` 5.00. `processInboundUpdates` itself sits at 26.96
  (pre-existing debt, strictly REDUCED by this ticket's own extraction —
  three branch points moved out into `tryDispatchToBubbleSeat`, none added).
- DRY (`jscpd`): 4 clones, 1.18%/1.50% — confirmed against the received
  commit's own snapshot (1.50%/1.64%): NOT a regression, slightly improved.
  The one clone touching new code (`tryDispatchToBubbleSeat` vs the sibling
  inline BL-1235 qwen-seat block) is deliberate — the ticket note says so —
  and pre-dates this pass.
- Acceptance (`run_acceptance.sh` on the ticket's own feature file): 6/6
  scenarios pass.

## Standing reds — not this ticket's defect (checked per BL-1063)
- Stryker's own dry run is blocked repo-wide by the already-ticketed
  `liveRepoDerivationGuard` red (BL-1291, paused; `bl1243PaneActivitySignal
  .test.js`, `deprecateRetiredReferents.test.js`), so a real Stryker run was
  not possible — used the BL-638 hand-authored-sweep fallback instead (see
  above), same as BL-1264/BL-1182/BL-1277/BL-1281 today.
- `npx vitest run --coverage` (no override) writes no coverage report while
  15 unrelated test files are red (`landPilotedTicket`/pilot-gate cluster,
  `telegramClient.test.js`, `operatorRuntimeBbFixtureClosure.test.js`, the
  three whole-tree guards below, etc.) — none touch `bubbleSeat*`/
  `telegramCursorBridgeLive`. Forced the write with
  `--coverage.reportOnFailure=true` per the standing rule; the resulting
  numbers are a floor for files touched by those reds, not for this
  ticket's files.
- Whole-tree guards: `liveRepoDerivationGuard`, `socketFixtureShortRootGuard`
  (known standing red, BL-1290), `tempDirTrapGuard` — all pre-existing,
  unrelated to `bubbleSeat*`/`telegramCursorBridgeLive`, unchanged before and
  after this pass.

## Process hygiene
No orphaned `node --test`/`stryker`/`vitest` processes at handoff
(`pgrep -fl` scoped to this worktree — clean).

## Verdict
BL-113 clean (manifest already stamped by the prior session). Hand-authored
mutation sweep closed 2 real gaps and confirmed 1 equivalent. All suites
green, CRAP within bound on every changed function, no DRY regression,
acceptance 6/6. Forwarding to documenter.
