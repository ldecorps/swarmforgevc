# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-02T07:30:20.295475465Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human directive (resolving the cost-reduction block): mint the descent-ladder as its own ticket NOW — 'auto-downgrade a seat's model until bounces rise'. It is currently unminted prose on epic BL-545, gated by BL-548 (blocked). The human chose minting the descent-ladder ticket over reprioritizing the existing paused BL-1056 (pri 12) / BL-1317 (pri 2). Specifier: mint the descent-ladder ticket.

---

## Drained 2026-09-02 (specifier) — already satisfied, not re-minted

This intake asked the specifier to mint the descent-ladder ticket. It was
already minted 35 minutes after this intake was filed:

- **BL-1327** — "Scheduled descent ladder: propose (never silently apply) a
  cheaper effort-then-model notch for a seat that stays guard-clean",
  `backlog/paused/BL-1327-scheduled-descent-ladder-proposes-cheaper-notch.yaml`,
  minted in `a390dfa60b` ("BL-1327: mint BL-545 descent-ladder remaining_slice
  as its own ticket", 2026-09-02 09:05:12 +0100). Intake filed
  2026-09-02T07:30:20Z.

Minting a second ticket for the same prose would have duplicated it, so this
intake is archived with a pointer instead. The human directive it carries is
preserved verbatim in BL-1327's `source_intake_2026_09_02` field, per Article
5.3.

Two facts worth carrying, both verified rather than assumed:

- The epic reference in the intake ("epic BL-545") is stale wording, not an
  error in the ask. BL-545 is closed in `backlog/done/M8/` and is a Telegram
  catch-up ticket; the descent ladder now lives under the
  `swarm-intelligence-layer` epic (`BL-1329`). BL-1327's own
  `approval_context` records the rename ("BL-545 at the time").
- The intake says "auto-downgrade". BL-1327 is proposal-only. That narrowing
  is the human's own later ruling on BL-1327 ("No autonomous model/effort
  mutation in this ticket. Guarded auto-apply, if wanted later, is a separate
  ticket."), which post-dates this intake. The auto-apply half is deferred by
  that ruling, not dropped by this drain.

BL-548, named in the intake as the gate, remains `status: blocked`.
