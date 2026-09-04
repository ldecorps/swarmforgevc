# BL-1296 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip-pure rebuild (`68da935d5d` -> `1e5b37648d`, merged into this
worktree at `23762d0a5f`). D1 (the earlier architect bounce — dead dispatch
branch because the turn seam had no default) is the defect this parcel closes;
verified below rather than assumed.

## Ruling verified before review (BL-1367/BL-1368 trap)

Checked `human_ruling:` and `human_approval:` on this ticket on both `main`
and `origin/main` before trusting the coder's evidence that a ruling now
exists — both carry it (line 73-74), text matches
`backlog/answers-archive/ANSWER-2026-09-03-bl1296-echo-vs-worker-strict-echo-relayed.md`
per the ticket's own provenance note. Not the earlier `(recommended)`-label
false-positive; this is a real recorded ruling (strict echo, option 1).

## Dependency gate (BL-259, hard gate)

    cd extension && node out/tools/dependency-gate.js \
      src/tools/bubbleSeatLive.ts src/tools/telegramCursorBridgeLive.ts

`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change (BL-255, informational)

`bubbleSeatLive.ts`'s co-changes are entirely in-scope (its own tests, step
handler, index.js registration, `bubbleSeat.ts`, its own evidence files).
`telegramCursorBridgeLive.ts` carries pre-existing SUSPECTED COUPLING against
~40 files (telegramCursorBridgeCore.ts, bridgeServer.ts, etc.) — a large,
long-coupled file; this parcel's diff to it is the ~59-line dispatch/wiring
addition, not a new coupling this ticket introduced. Consistent with the
cleaner's same conclusion. Not actionable here.

## Architecture read (two-layer boundary, I/O ownership, secrets)

- `bubbleSeatLive.ts` performs; `bubbleSeat.ts` (unchanged, pure) decides —
  the decide/perform split the project's architecture rules require is kept.
- No agent process is spawned to bypass tmux/the bridge poll: the seat drives
  `processLetsTalkTurn` against the SAME live agent session the Let's Talk
  route already uses, inside the bridge's existing poll (invariant 3 — no
  second `getUpdates` owner).
- All I/O (Telegram post, agent session) stays in the extension host; no
  webview involvement, no browser storage, nothing written to the target
  working directory. No secrets touched.
- Wiring in `telegramCursorBridgeLive.ts` follows the sibling BL-1235 seat's
  own shape exactly (`deps.runBubbleSeatTurnFn ?? runBubbleSeatTurn`,
  dispatched before cursor's decision, topic id read from the same map via
  `bubbleMirrorTopicForPath` — never a second way to learn it).

## Invariants (BL-633/654) — all three declared, all three covered

1. Never diverges (structural): `runBubbleSeatTurn` posts the front desk's
   `replyText` unedited; no code path in the module composes a reply. Property
   test pins this byte-for-byte; NON-VACUOUS per coder/cleaner evidence
   (composing `` `Bubble says: ${replyText}` `` fails it).
2. Own topic only: `decideBubbleSeatTurn`'s gate runs FIRST, before the front
   desk is asked anything — a foreign-topic message never causes a turn.
3. One `getUpdates` owner: the seat runs inside the bridge's existing poll,
   same posture as the qwen seat; opens no second poller.

No missing or vacuous property test found — declined to re-verify vacuousness
by hand-breaking since coder/cleaner already documented the break-then-fix
result; spot-checked the property file's assertions match that claim.

## Verification run directly (not just trusted from evidence)

- `cd extension && node out/tools/dependency-gate.js …` — PASSED (above).
- `npx vitest run bl1296BubbleSeatTurn bl1296BubbleSeatLive bubbleSeat.test
  telegramCursorBridgeLive bridgeServer` — 268/268.
- `npx vitest run --config vitest.properties.config.mjs
  bl1296BubbleSeatInvariants` — 5/5.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1296-bubble-answers-from-its-own-seat.feature` — 6/6.
- `specs/pipeline/steps/index.js` — `bl1296BubbleSeatSteps` registered
  (required_wiring satisfied).

## Property-testing pass (own section, BL-654 scope boundary)

The three declared invariants are the ticket's own property-test obligation
and are the coder's to author (reviewed above). No OTHER touched pure module
needs new property coverage: `bubbleSeat.ts`'s `decideBubbleSeatTurn` is
unchanged by this parcel and already carries its own property suite from the
prior ticket that introduced it.

## Correctness read

No defect spotted beyond the architecture/invariant checks above. `qa_e2e`
(live phone demonstration) is explicitly QA's, not claimed here — agreed with
coder/cleaner's own disclosure.

## Verdict

No defect found. Forwarding to hardener.
