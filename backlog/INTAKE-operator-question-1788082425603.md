# Intake: a question the Operator could not answer

Filed by the Operator (2026-08-30T09:33:45.603741322Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

I haven't seen any detailed around the spec tip text filter...

---

## Specifier status (2026-08-30 20:57 +0100) - NOT yet drained, and why

Read, not guessed at. The question as filed is truncated mid-sentence
("...the spec tip text filter...") and there is no such thing anywhere in
this repo: grepping `backlog/`, `docs/`, `extension/src/` and `swarmforge/`
for "tip text filter", "spec tip" and "tip-text" returns this intake file
and nothing else. So there is no way to tell which surface is meant, and
minting against a guess would be exactly the failure `role_ask.bb` exists
to prevent.

The clarifying question cannot be raised right now: only one `role_ask` may
be pending per role, and the specifier slot is held by an older unanswered
question (the 2026-08-30 worktree-drift-storm attribution, asked 16:18Z).
`deliver-role-answer.js --role specifier` reports `already-consumed`, which
per BL-1244/BL-1245 means the drift question is genuinely still outstanding
and the marker must be left alone - archiving it would discard a live
question the human is still being asked.

**Next step, no action needed from anyone:** when the drift question is
answered and its slot clears, the specifier asks the human what "the spec
tip text filter" refers to and drains this intake normally. It stays in the
backlog root until then, which is the correct state for an undrained intake.

**Recheck 2026-09-01 (specifier):** still blocked on the same slot.
`deliver-role-answer.js --role specifier` returns `already-consumed` (drift
question genuinely unanswered, marker left in place), and a fresh grep for
`spec.?tip|tip.?text|tip.?filter` across extension/src, docs, swarmforge,
specs, and the live backlog still returns nothing. Nothing changed; no action
taken, none needed until the slot clears.

**Recheck 2026-09-02 (specifier):** still blocked, third day, same cause and
same evidence. `deliver-role-answer.js --role specifier` returns
`already-consumed`; the stored answer in
`.swarmforge/operator/role-answers/specifier.json` is the 2026-08-28
reconcile-sweep one (`askedAtMs` 1787919016568, consumed 12:17Z), while the
live marker holds the 2026-08-30 drift question (`askedAtMs` 1788106704878).
Those do not pair, so per BL-1245 the drift question is genuinely unanswered
and the marker is left exactly as it is - `--resolve` here would discard a
live question. A fresh grep for `spec.?tip|tip.?text|tip.?filter` across
extension/src, docs, swarmforge, specs and the live backlog still returns
this file and nothing else, so there is still nothing to spec against.

Noted, not re-minted: one unanswered clarification holding a role's only
question channel indefinitely is the attention problem epic BL-772 already
owns (slices BL-836/837/838 - pending clarification read and answered over
the bridge, and the collapsed Bubble pulsing while one waits). This intake is
evidence for that epic's value, not a new ticket. The coordinator has been
notified that the drift question needs a human answer.

**Structural remedy minted 2026-09-02:** the recurring half of this block — an
unanswered question holding a role's only channel with nothing telling the human
it is waiting — is now **BL-1347** (BL-772 slice E, `backlog/paused/`), which
extends BL-584's stale-approval email sweep to cover role asks. That does not
unblock this intake: BL-1347 makes the wait visible, it does not end it, and
clearing a wedged slot is deliberately left to slice D. This intake still needs
the 2026-08-30 drift question answered before its own clarification can be
raised. The marker is untouched.

**Recheck 2026-09-03 (specifier) — root cause of the block found and ticketed.**
Still undrained, same wedged slot, but this pass established *why* the drift
question has gone unanswered for four days, and it is not the human ignoring it:
**they were never told.**

GH-25 shipped the escalation that is supposed to alert on exactly this — a role
question unanswered past its threshold — and it has never delivered once. It is
wired into the live tick (`operator_runtime.bb:2360`) and runs every ~31s, but
its ops issue number ships commented out (`# config ask_escalation_issue 25`)
with `SWARMFORGE_ASK_ESCALATION_ISSUE` unset, and GH-25 specced a missing value
to degrade to a status.json key plus a log line. Nothing outside GH-25's own
tests reads that key. Evidence off disk this pass:
`status.json` → `"ask_escalation":{"transport":"unconfigured"}`, and **7027**
`ask-escalation WARN ops issue unconfigured - no stamp` lines since
2026-08-30T06:36:32Z — which begins ~10h before the drift question was even
asked, so no question raised since 08-30 has ever escalated.

Minted as **BL-1352** (`type: defect`, `severity: high`, `backlog/paused/`,
commit `c436a0d374`). The transport choice is posed to the human there as
`ruling_options`, which costs no `role_ask` slot — so that decision can be taken
while this slot is still wedged.

This does NOT drain the intake and does not unblock it. BL-1352 makes the wait
visible; ending it is BL-772 slice D (a withdraw verb for a genuinely unanswered
question — `--resolve` asserts an answer IS on record, so it is not legitimate
here), which remains unminted. The marker is untouched, again.
