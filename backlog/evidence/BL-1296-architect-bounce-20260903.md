# BL-1296 — architect bounce (2026-09-03)

## Review pass completed before this bounce (Article 4.4 — complete inventory)

- Merged cleaner `a1e7fdfe4c` (coder `500e6826c4`) into architect worktree.
  One trivial `require(...)`-list conflict in `specs/pipeline/steps/index.js`.
  A collateral fix this commit made to `bl1337ProfileCastInvariants.property.test.js`
  (an independently-discovered fix for the same luck-drawn-reach-floor shape
  I separately bounced on BL-1337) is moot — that file has since been
  correctly deleted again by a later merge of my BL-1337 revert; no action
  needed.
- `bubbleSeat.ts` reviewed: invariant 1 (mirror-only, structural via the
  `answer` variant's single `via: 'front-desk-mirror'` literal), invariant 2
  (topic gate as the first clause, no delegate/fallback field), and
  `cursorBusy` deliberately unread are all confirmed by reading the code, not
  just the evidence narrative.
- `required_wiring` (`specs/pipeline/steps/index.js::bl1296BubbleSeatSteps`):
  confirmed registered.
- `npx vitest run bubbleSeat.test.js telegramCursorBridgeLive.test.js` —
  132/132 pass.
- `run_acceptance.sh specs/features/BL-1296-…feature` — 6/6 pass.
- `npx vitest run --config vitest.properties.config.mjs
  bl1296BubbleSeatInvariants` — 3 consecutive runs, 3/3 tests each, no flake.
- Dependency-rule gate (BL-259), scoped and full-repo: PASSED, no forbidden
  edges.
- Co-change report (BL-255): all reported co-changes at frequency 1 — no
  suspected coupling.

## D1 — the seat is never wired to a real topic id or a real turn function; the ticket's central ask is not deliverable as shipped

- **Files**: `extension/src/tools/telegramCursorBridgeLive.ts` (the
  construction site around line 2354, where `qwenLocalTopicId` is populated
  for the sibling BL-1235 seat), `extension/src/bridge/bubbleMirrorTopic.ts`
  / `telegramCursorBridgeCore.ts` (where `bubbleTopicIdFromMap` already
  exists and is used elsewhere for the mirror).
- **Class**: correctness/completeness — the shipped code is well-designed and
  well-tested for what it covers, but the ticket's central deliverable
  ("Bubble gets its own answering seat so it stays answerable while the
  Cursor seat is busy") is not actually reachable in production.
- **What I found, read not guessed**: `bubbleSeatTopicId` and
  `runBubbleSeatTurnFn` are declared on `CursorBridgeLoopDeps` and consulted
  in the dispatch branch, but **nowhere in `telegramCursorBridgeLive.ts` is
  either one ever populated at the real bridge construction site**. Compare
  directly against the sibling BL-1235 seat this ticket's own description
  says to ride on:
  - BL-1235: `qwenLocalTopicId: readQwenLocalTopicId(env.repoRoot)` is set at
    the live construction site (line 2354), and `runLocalSeatTurnFn` falls
    back to the REAL `runLocalSeatTurn` by default
    (`deps.runLocalSeatTurnFn ?? runLocalSeatTurn` at line 2028) — genuinely
    wired end to end.
  - BL-1296: no equivalent line sets `bubbleSeatTopicId` anywhere, and
    `deps.runBubbleSeatTurnFn` has no `?? realFunction` fallback at all — the
    dispatch guard (`deps.bubbleSeatTopicId !== undefined && deps.runBubbleSeatTurnFn`)
    is unconditionally false in production today, so this entire code path is
    dead in the live bridge.
  - Confirmed the topic-id half of this has NO legitimate "live-agent" excuse:
    `bubbleTopicIdFromMap` already exists in `telegramCursorBridgeCore.ts` and
    is already used by the existing Bubble MIRROR machinery
    (`bubbleMirrorTopic.ts`'s `readCursorBridgeTopicIds`) to read the exact
    same topic id from `.swarmforge/operator/cursor-bridge-topic-map.json`.
    Wiring `bubbleSeatTopicId: bubbleTopicIdFromMap(...)` at the real
    construction site is a pure, file-reading, already-tested operation —
    identical in kind to `readQwenLocalTopicId`, not a live-agent concern.
- **Consequence if forwarded unfixed**: the ticket's own `qa_e2e` requires a
  literal live demonstration ("occupy the Cursor seat with a long turn and
  confirm from the phone that a message sent to the Bubble topic is answered
  while that turn is still in flight"). As shipped, no amount of QA effort
  can produce that demonstration, because nothing in production ever routes
  a message to a Bubble worker — the human's own stated goal ("Same answers
  as the front desk, just not blocked behind Cursor's current turn") is not
  delivered.
- **On the coder's own disclosure**: the coder's evidence explicitly names
  this gap ("What this slice does NOT do... binding it to a live worker
  process... is deliberately not smuggled in here: it is a live-agent
  concern"). I do not dispute that *some* part of this — choosing and
  running the actual model/process that produces `runBubbleSeatTurnFn`'s
  answer — may legitimately need its own slice, the same way BL-1235 needed
  a real ollama/qwen process. But narrowing a ticket's own qa_e2e-mandated
  deliverable is a scope decision for the SPECIFIER (the BL-1328 precedent
  earlier this session: the coder raised a spec-gap note and the specifier
  amended the ticket in writing), not something the coder decides
  unilaterally in an evidence paragraph. And at minimum, the `bubbleSeatTopicId`
  wiring has no such excuse at all and should simply be done in this same
  parcel.
- **Remediation pointer**:
  1. Wire `bubbleSeatTopicId` for real at the bridge construction site
     (mirroring `qwenLocalTopicId: readQwenLocalTopicId(env.repoRoot)`),
     reusing `bubbleTopicIdFromMap`/`readCursorBridgeTopicIds` — this alone
     makes the dispatch branch reachable and testable end-to-end without
     requiring any new live-agent work.
  2. For `runBubbleSeatTurnFn`: either (a) implement a genuine, if minimal,
     "relay the front desk's own answer" default (the human's own suggested
     shape, and possibly requiring no new live agent at all — worth checking
     whether the front desk's existing reply is already computed somewhere
     this seat could read), so the feature is actually demonstrable, or
     (b) if a real live-agent process genuinely cannot fit in this slice,
     raise a priority-00 spec-gap note to the specifier asking to split the
     ticket (BL-1328's precedent), rather than deciding the narrowing alone.

## Nothing else found

D1 is the sole defect. The pure decision module, invariants 1–3, dependency
gate, co-change, and every existing test are clean and do not need to be
re-run once D1 is addressed.

## Action taken

Recorded via `record-bounce.js` and sending `git_handoff` back to coder,
naming this evidence file and the failure class.
