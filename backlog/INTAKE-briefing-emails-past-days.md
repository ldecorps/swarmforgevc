# Raw intake — DEFECT: daily briefing emails for past days keep arriving

Status: new intake, not minted. Capture only (human via Cursor 2026-08-05
~10:07 CEST). **Small defect, real inbox pain** — drain soon; not Bubble
polish.

Related
- `swarmforge/scripts/briefing_email_lib.bb` — `find-unsent-briefings` /
  `send-unsent-briefings!`: every `docs/briefings/*.md` not listed in
  `docs/briefings/.sent.json` is emailed, **oldest first**, no date/age gate.
- `handoffd.bb` briefing sweep calls that path every tick.
- BL-214 design: mark sent only after a real success (correct); the marker
  file is the idempotency gate.
- Observed 2026-08-05: committed `docs/briefings/.sent.json` on `main`
  stopped at `2026-08-01.md`, while `2026-08-02.md` … `2026-08-05.md` already
  existed on disk. Local working tree had already recorded 02–05 as sent
  after successful sends, but that update was **never committed/pushed**.
  Any checkout whose `.sent.json` matches `main` will treat those four
  (and any future lag) as unsent and mail them again as "past day"
  briefings.

## Goal

1. The human receives **at most one email per briefing file**, and under
   normal operation **only the current day's** (or the ceremony's intended)
   briefing — not a backlog of past calendar days flooding the inbox when
   the sent-marker drifts.
2. After a successful send, the sent-marker update is **durable** the same
   way the briefing itself is (committed, or otherwise shared across the
   hosts that run the sweep) so a pull / second machine / fresh worktree
   cannot re-mail history.
3. Defence in depth: even if the marker is stale, do **not** blindly email
   every historical unsent `.md` without a bound (today-only, or a short
   catch-up window the specifier pins).

## Problem

- Human report: receiving daily briefings **for past days**.
- Root shape (verified in-repo 2026-08-05): send path is "all unsent `.md`",
  and `.sent.json` durability lags the markdown files on `main`.

## Why this matters

- Past-day briefings are noise; they bury today's signal and look like the
  swarm is confused about what day it is.
- Continuous 3-shift + multi-checkout makes an uncommitted local marker
  especially dangerous.

## Human decisions / defaults (2026-08-05)

Specifier may challenge; do not silently drop.

1. **Defect**, `severity: medium` default (inbox spam, not pipeline
   blockage). Raise to `high` if the human says the flood is still ongoing
   after the marker catch-up.
2. **Fix both legs**: (A) make successful sends persist `.sent.json` onto
   the shared/durable store the sweep reads (scoped git commit of the
   marker is the obvious fit — same family as other durable operator
   bookkeeping); (B) add a **send policy** so a stale marker cannot dump
   the whole archive (default proposal: only email briefings whose date
   label is **today UTC**, or today and yesterday — specifier picks; never
   unbounded historical catch-up without an explicit one-shot operator
   action).
3. **Immediate mitigation** (operator/coordinator, same day): commit and
   push the current `.sent.json` that already lists through `2026-08-05.md`
   so `main` matches reality. That stops the current flood; it does not
   close the defect.

## Requested outcome

1. Specifier mints a paused defect with Gherkin covering: successful send
   updates durable sent state; a checkout with stale marker + old `.md`
   files does not re-mail days outside the allowed window.
2. Coder lands A+B; QA verifies no re-send of an already-mailed day after
   pull.

## Out of scope

- Briefing content quality / lean closing ceremony (separate intakes).
- Retiring evening/pilot `.md` siblings in `docs/briefings/` unless they
  also false-trigger under the new policy (mention in notes if relevant).
