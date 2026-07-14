# INTAKE: The briefing email is malformed — the subject swallows the lede, the body buries the observables

**Raised by:** the human (ldecorps), 2026-07-14, from the received email:
"morning briefings are malformed: the title is far too long. the content too
thin. it has lost all the technical observables about the swarm runtime."
**Relayed via:** the Claude Code session, which root-caused both symptoms in
code before filing. Human-raised; the relay is transport.

## Finding 1 — the subject line contains the entire lede (CONFIRMED in code)

`briefing_email_lib.bb` `build-briefing-subject` (line ~46) appends the
briefing's FIRST NON-EMPTY LINE as the headline, per BL-099 briefing-03
("subject names the date and the headline"). That contract silently assumed
the document opens with a short headline. Today's briefing style opens with
a multi-sentence lede PARAGRAPH — one markdown line — so the subject became
the full paragraph, raw `**bold**` markers included. The human's screenshot
is one screen-and-a-half of subject. `banked_briefing_lib.bb` documents the
same first-line-is-subject coupling, so both compose paths inherit it.

Ask: subject = `SwarmForge briefing <date> — <headline>` where headline is
bounded (~80 chars), markdown-stripped, and cut at a sentence/word boundary.
Better still, make the contract explicit instead of positional: the briefing
author writes a dedicated one-line title (e.g. a leading `# ...` heading or
a `headline:` line) and the emailer uses exactly that; first-line fallback
only when absent. Guard test: no subject over N chars, never contains `**`.

## Finding 2 — the observables are IN the document but unreadable in the email

The human's complaint "lost all the technical observables" is a presentation
loss, not a data loss: `docs/briefings/2026-07-14.md` on main contains the
full Delivery metrics / Agent business / Optimizer / Process hiccups
sections (velocity, cycle time, suite duration, per-role token cost,
stage-dwell, the 10 pending approvals). But the emailer sends the markdown
as PLAIN TEXT (`send-email! subject content`; `:html` is used only for the
optional diagram section). On a phone client, `##` headings, pipes and
`**bold**` render as an undifferentiated wall and the metrics disappear
into it — the human reasonably read it as "thin".

Ask: render the briefing markdown to simple HTML for the email body (the
send path already accepts an :html argument — extend it to carry the full
rendered body, keeping the plain-text version as the alternative part).
No new prose generation; presentation only. Acceptance: the metrics tables/
sections are visually distinct in a phone mail client.

## Verify while in there (cheap, may be a third defect)

Confirm the SENT body is byte-complete: that the banked/headless compose
path emails the whole document including the appended computed blocks
(suite-duration trend, needs-approval section), not a truncated or
lede-only variant. Yesterday's evidence base has several "emitter exists
but host-gated/partial" precedents (BL-335/336/349), so prove delivery,
not just composition.

## Adjacent, do not duplicate

- BL-308 (banked-mode headless briefing) owns WHO composes; this item is
  only about how the result is titled and rendered.
- BL-391 ("the human is never sent terminal chrome", active) is the same
  spirit for Telegram — human-facing surfaces get human-grade rendering.
