# BL-607 — architect PASS (3rd review, both prior bounces verified fixed)

**Verdict:** PASS → forward to hardender. The two prior architect send-backs are
both fixed and re-verified in this worktree; architecture is clean; property
support added for the exact defect class that bounced twice.

Reviewed commit: cleaner forward `10f7834a73` (coder fix
"sanitize multi-line dormant-pane answers before queueing"), merged into
`swarmforge-architect` as `eea22750e`.

## Prior defects — both re-verified fixed

- **Bounce 1 (compile break, 52 errors — severed re-export interface).**
  `npm run compile` GREEN; full unit suite 5826 passed. Fixed at `172791e30`
  (restore re-export barrel), unchanged by the latest commit.
- **Bounce 2 (short multi-line free-text answer silently LOST on the dormant
  leg).** Fixed at `10f7834a7`:
  - `fitsInlineInRoleAnswerNote(text)` now gates on BOTH `length <= 80` AND
    "no C0/DEL control char" (`/[\x00-\x1f\x7f]/`), and is shared by
    `composeRoleAnswerNoteMessage` and `writeRoleAnswerFileIfNeeded`, so any
    answer carrying a newline routes through the pointer-file fallback (lossless
    — full text recoverable from `.swarmforge/operator/role-answers/<role>.json`)
    instead of corrupting the single-line `message:` header.
  - The silent-loss secondary is closed too: `deliverAskAnswer` and
    `processSteeringUpdate` now clear the per-role pending marker ONLY when a leg
    actually captured the answer (`delivered` OR `enqueueRoleAnswerNote() === true`),
    at both call sites. The short-circuit preserves "don't double-queue when the
    live pane already delivered."
  - New non-vacuous tests reproduce the end-to-end failure: a `<=80`-char
    2-line answer now yields a valid single-line pointer note, the full text is
    stored and recoverable, and a failed queue leaves the marker set (both the
    free-text and button-tap paths).

## Architecture (hard gate + boundaries)

- **Dependency-rule hard gate PASSED** — no forbidden edges on all three changed
  src files (`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`).
- Two-layer boundary respected: host owns I/O (the dormant leg shells
  `swarm_handoff.bb`, never hand-writes `inbox/new/`; `role_ask.bb` owns state;
  TS owns Telegram rendering). No webview storage, secrets stay in host env,
  integrate-not-fork all intact.
- **Co-change report:** only expected structural coupling (the subsystem's
  core + CLI + their tests + the step-registry index). No surprise logical
  coupling introduced by this parcel. Informational only — no send-back.
- **BL-506 scope:** parcel touches only its declared files; no ticket-less
  functional files folded in.

## Property support (architect-owned)

Added `extension/test/telegramFrontDeskBotCli.property.test.js`: for any role and
ANY answer text (control chars at arbitrary positions, multiple newlines,
arbitrary UTF-16, arbitrary length), `composeRoleAnswerNoteMessage` always yields
a valid single-line swarm_handoff.bb `message:` header (no control char, `<= 80`
chars). Generalizes the four hand-picked example points across the whole input
space — the exact invariant the ticket bounced on twice. Verified NON-VACUOUS:
with the control-char guard removed the property fails, fast-check shrinking to
the minimal counterexample `["coordinator","\n"]`; restored → green. Runs only
via `npm run test:properties`; excluded from the normal unit/coverage/mutation
run (unit suite still exactly 5826).

## Minor observation (NOT blocking — for downstream awareness)

In `deliverAskAnswer` (button-tap path) `editAskMessageIfKnown` still runs even
when `captured` is false, so on an infra-failure edge (dormant pane AND the
queue itself fails) the Telegram ask message could show "answered" while the
per-role marker correctly stays pending. This is button-tap-only (labels are
author-controlled and single-line, so `captured` is effectively always true in
practice) and there is NO silent answer loss (the marker stays set → the answer
is recoverable/retryable). Not a correctness defect; noted for completeness.

— By architect.
