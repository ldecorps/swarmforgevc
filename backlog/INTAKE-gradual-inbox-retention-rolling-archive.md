# Raw intake — Gradual inbox retention: rolling archive so completed/ and sent/ stop growing without bound

Status: **new intake, not minted.** Capture only (human via Let's Talk /
Cursor, 2026-08-22 ~16:14 CEST).

## Human ask (same session, paraphrase)

Rather than a hard general size cap on inboxes, prefer a **drip** approach
("torture au fil de l'eau"): shrink mailbox history gradually over time.

Desired shape the human named:

1. **Not** a one-shot wipe or a single hard ceiling on inbox size.
2. As roles work their mail (or on a gentle ongoing cadence tied to that
   work), older already-settled mail is **archived** out of the hot
   `completed/` / `sent/` trees.
3. Keep a **rolling window** of recent history — human suggestion: about
   **two weeks**; older than that leaves the hot path.
4. Goal: stop completed/ and sent/ from ballooning forever, so sweeps and
   other mailbox walks stay cheap and host CPU stays healthy.

## Why this exists (context, not a second defect claim)

- **BL-978** (done) fixed the dropped-parcel sweep so one sweep builds a
  trail index once instead of re-walking every mailbox file per active
  ticket. Measured at mint: ~5900 files under completed/ and sent/, growing
  monotonically; worst sweep boundary ~143s with zero nudges emitted.
- BL-978 **explicitly left out of scope** retention/compaction of
  completed/ and sent/, and recorded it as a named follow-on that needs a
  **human call** (deleting or moving mailbox history is not an incidental
  fix for a scan bug).
- Boy Scout (epic BL-1013 / active hygiene slice) is **not** this: it
  classifies or cleans repo debt; it does not bound mailbox retention.
- Live CPU pain on 2026-08-22 (mean-ticket-time / BL-1066) is a separate
  defect. This intake is about **mailbox growth as a standing cost floor**
  for every handoffd pass that still lists those dirs — complementary,
  not a substitute for BL-1066.

## Goal (specifier decides exact shape)

Make hot mailbox history **bounded in time** (rolling retention), with
reduction happening **gradually** so live mail delivery and in-flight
work are not shocked.

Open questions for the specifier (defaults welcome; human already leaned
toward drip + ~2-week window):

1. **What moves** — only `inbox/completed/` and `*/sent/`, or also other
   settled dirs? Never touch `new/` or `in_process/` live work.
2. **Where it goes** — archive tree under the same handoffs root, cold
   storage, or delete after copy? Durability / audit needs a clear answer.
3. **Who runs it** — piggyback on role dequeue / read paths, a bounded
   handoffd janitor tick, boy-scout-adjacent cron, or operator-triggered
   first then automate?
4. **Window** — confirm ~14 days rolling, or make it conf-tunable with
   that as default.
5. **Pace** — max files or bytes moved per tick so a first run on today's
   ~thousands of files drains over many cycles ("au fil de l'eau") instead
   of one giant archive pass.
6. **Evidence consumers** — anything that still needs older trails
   (dropped-parcel freshness, audits) must keep working: either read the
   archive, or accept that trails older than the window are out of scope
   for those checks (human must lock this).

## Firm lines (from human + BL-978 notes)

- No big-bang empty of inboxes as the primary design.
- No "fix" that only raises supervisor freshness thresholds.
- Retention policy is a deliberate product decision; do not smuggle it
  into an unrelated sweep-speed ticket.
- Live parcels in `new/` and `in_process/` are sacred until settled.

## Suggested classification (human posture this session)

- **Type:** feature / reliability hardening (not a hotfix defect unless
  the specifier finds an active outage tied only to mailbox bloat).
- **Priority:** ordinary queue is fine unless host load recurs from
  mailbox walks alone after BL-1066 lands — then revisit.
- **Related:** BL-978 follow-on (b); cite BL-977/BL-978 family; do not
  merge into BL-1066.

## Source

Human via Let's Talk (Cursor), 2026-08-22. Session thread: gradual
inbox shrink after discussing BL-978 (scan fix without compaction) and
rejecting a plain global size cap in favor of rolling archive-on-use /
drip retention.
