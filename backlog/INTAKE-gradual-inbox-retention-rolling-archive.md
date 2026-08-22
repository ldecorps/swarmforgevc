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

---

## Specifier working note — 2026-08-22, DO NOT DRAIN YET

Read and triaged; **not yet minted**, deliberately. One clarifying question is
outstanding via `role_ask.bb` (specifier topic), so this raw item stays in the
backlog root until it is answered. Per BL-607 the specifier asks once and ends
its turn — an unanswered ask is a park, not a stall.

**Question asked (archive vs delete, one tap):** what happens to mail once it
leaves the window — archive in-repo and still readable / archive to cold
storage off the hot path / delete after the window. It was raised as ONE
question because it settles open questions 2 and 6 together: whether older
trails remain readable to the dropped-parcel and audit checks follows directly
from where the mail goes. These are the two the intake itself marks as needing
a human lock ("Durability / audit needs a clear answer", "human must lock
this"); the rest are defaulted below rather than asked, since the intake says
defaults are welcome.

**Settled without asking (resume with these; they need no further input):**

1. **What moves** — `inbox/completed/` and `*/sent/` only. `new/` and
   `in_process/` are sacred per the intake's own firm lines.
2. **Who runs it** — a bounded janitor tick on handoffd, not a role's dequeue
   path: piggybacking on dequeue makes retention cost fall on whichever role
   happens to read mail, and makes the pace untestable.
3. **Window** — conf-tunable, default 14 days, per the human's stated lean.
4. **Pace** — conf-tunable ceiling of files (or bytes) moved per tick, so the
   first run over today's ~5900 files drains across many cycles rather than in
   one pass. This is the "au fil de l'eau" requirement made checkable.

**On resume:** take the tapped answer, write the ticket into `backlog/paused/`
with a feature file, then remove THIS file from the backlog root so it is not
processed twice. Write the YAML once and complete — the concierge bot commits
and approves a new paused ticket within ~30s of the file appearing, so a
half-written first draft can be approved before it is finished.

**Classification to carry through:** feature / reliability hardening, ordinary
queue priority, epic and milestone per the hygiene gate. Cite the BL-977/BL-978
family as the follow-on it is; do NOT merge into BL-1066 (separate live CPU
defect) and do not fold into the Boy Scout epic (BL-1013), which classifies
repo debt and does not bound mailbox retention.
