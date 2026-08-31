# BL-1253 — coder pass after the QA bounce, 2026-08-31

Task: `BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1`
Bounce answered: QA `207dc0c03b`, class `acceptance` (scenario 06 had no step
handler).

Review-only ticket. **Nothing in the hotfix was reimplemented, rewritten or
reverted** (invariant 1), and **no ledger state was written** (invariant 2).

## The bounce is closed

Scenario 06 ("A recovered feeder gets the token back") now has its handler
and the suite is **8/8**, not 7/8:

```
run_acceptance.sh specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature
# tests 8   # pass 8   # fail 0
```

The remedy was already on `main` when this parcel reached me — the coder
rework `026ae2aa3` added scenario 06 and invariant 3, and QA's own
`8674998ad6` repaired the partial resurrection that had left the handler
unregistered in `index.js`. Re-verified rather than assumed: the run above is
mine, at this tip, and `required_wiring`'s single row
(`bl1253DeadFeederOwnsGetUpdatesStampSteps` in `specs/pipeline/steps/index.js`)
holds.

## The stamp itself — `qa_e2e_procedure`, walked against the landed sources

Read at commit `2ec06b6ef1` itself, not at a later tip, so the review is of
what actually landed.

| Step | Finding | Verdict |
|------|---------|---------|
| (1) `frontDeskPollHeartbeatPath` / `readFrontDeskPollHeartbeatMs` defined | both exported from `cursorBridgeInboundQueue.ts` (:16, :25) | **CONFIRMED** |
| (1b) the reader returns `null` for missing or unparseable | `JSON.parse(readFileSync(...))` inside `try`, `catch { return null }`; a parsed record whose `lastHeartbeatMs` is not a finite number also returns `null`. Missing file, malformed JSON and wrong-typed field all reach `null` by different routes | **CONFIRMED** |
| (2) liveness consulted every poll, not once at start | `runCursorBridgePollOnce` (`telegramCursorBridgeLive.ts:2116`) calls `deps.resolveUseInboundQueue()` **inside** the per-poll function; the live wiring passes `() => resolveInboundQueueFromFeeder(opDir)` (:2309), which re-reads the heartbeat and re-computes `isFrontDeskInboundFeederLive` on each call. The pre-existing `useInboundQueue` boolean survives only as the fallback when no resolver is injected | **CONFIRMED** |
| (3) `start_cursor_bridge.sh` defaults to `0` against a dead feeder | :59 only defaults when the operator set nothing; live feeder → `export CURSOR_BRIDGE_INBOUND_QUEUE=1` (:73), not live → an explicit stderr line and `=0` (:75-76). An explicit operator setting is never overridden | **CONFIRMED** |
| (4) unit tests over the touched test files | `cursorBridgeInboundQueue.test.js`, `telegramCursorBridgeCore.test.js`, `telegramCursorBridgeLive.test.js` → **258 pass**; `telegramCursorBridgeCore.property.test.js` → **3 pass** | **CONFIRMED** |
| (5) leave `Hotfix-Certification` pending | ledger row for `2ec06b6ef1`: `state: stamp-open`, `stamp_ticket: BL-1253`, `human_decision: null`, `decided_at: null` — untouched by this parcel | **CONFIRMED** |

**Review verdict: the landed behaviour matches what the ticket describes. No
defect found, so no follow-up ticket is opened** (the ticket's own "open a
narrow follow-up only if review finds a defect").

## Declared invariants — all three carry a passing executable encoding

| # | Encoding | Result |
|---|----------|--------|
| 1 (never reimplements) | not executable — a property over this parcel's own diff, not over a testable module. Stated reason, per the coder invariants contract: the parcel touches no hotfix source, which the review stages verify from the diff | reason recorded |
| 2 (green tests never certify) | acceptance scenario "The ledger row stays pending until a human decides" | pass |
| 3 (one getUpdates poller per token, and the token comes back) | `extension/test/bl1253TokenOwnershipInvariants.property.test.js` — "any sequence of feeder states keeps at most one poller on the token" and "the token can change hands repeatedly in one process" | **4 pass** |

## STILL OUTSTANDING — must not be closed without it

The **90-second stall window** decision, carried verbatim from retired BL-1260
into `approval_context` under Article 5.3, is **unanswered**. It is a human
question about the safety margin, not something this pass can settle:
`DEFAULT_FRONT_DESK_FEEDER_STALL_MS = 90_000`
(`telegramCursorBridgeCore.ts:371`, confirmed live at this tip). If the
liveness judgement is ever wrong in the optimistic direction, two pollers hold
one token — the Telegram 409 class.

Whoever takes the ledger decision: **`certified` or `waived` for `2ec06b6ef1`
requires answering the 90s question as part of that same decision.** A green
suite is not an answer to it, and this evidence file is not one either.

Also unverified, deliberately and per the ticket's own `out_of_scope`: the
commit landed under `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`, and the claim
that the skipped reds were unrelated is **not** checked here.

## Not swept

`swarmforge/scripts/wait_pipeline_drain.sh` is untracked in this worktree and
predates this session. Surfaced, not staged, not deleted.
