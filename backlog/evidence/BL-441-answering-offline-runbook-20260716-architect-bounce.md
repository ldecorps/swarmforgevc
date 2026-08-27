# BL-441 architect review — 20260716

## Verdict: BOUNCE to coder — the runbook makes a false factual claim about the PWA

## What was reviewed

Merged cleaner's `f54f49ef46` (coder's `bab3abd520`, forwarded unchanged) into
the architect worktree. This is a docs-only parcel: the only content change is
`docs/runbooks/BL-441-answering-offline-runbook.md` (new file); everything
else in the merge is backlog bookkeeping (paused→active rename for BL-441,
active→done renames for BL-432/438/440, topic JSON updates) from syncing
`main`. No TypeScript/JS/shell source changed, so `dependency-gate.js` and
`co-change-report.js` have nothing to check here (confirmed by running both
against the changed file — no source, no co-changers).

## The defect

The runbook's "Reading pending questions offline" section (lines 6-19) claims
two offline read surfaces for a pending swarm question:

1. Git-committed `backlog/topics/*.json` (BL-329) — **accurate**. Verified:
   these files exist per ticket, are git-committed, and carry the swarm's
   outbound question as their latest message.
2. "The PWA dashboard (`pwa/index.html` → `pwa/app.js`) ... It surfaces which
   tickets are waiting on a human at a glance." — **false as written**.

I read `pwa/app.js`, `pwa/index.html`, and `pwa/locales.js` directly.
`pwa/app.js` fetches exactly three files: `backlog.json`, `docs-tree.json`,
`recert-batch.json` — never `backlog/topics/*.json` and never any fleet-status
artifact. `backlog.json` (from `backlogDashboard.ts`) carries exactly one
human-facing flag, `needsApproval`, derived from `item.humanApproval ===
'pending'` — a **different, unrelated** mechanism (reviewing a swarm
proposal/rule change) from BL-438/BL-440's "pending question awaiting an
answer" signal. Grepping `pwa/app.js`, `pwa/index.html`, `pwa/locales.js` for
`pending|question|topic|needsHuman|waiting` turns up nothing tied to
answering the swarm — only the unrelated `needsApprovalEmpty` string. The
actual BL-438 `needs_human` on-disk signal is emitted by
`emit-fleet-status.ts` into a fleet-status artifact the PWA never reads.

So a human who checks the PWA expecting to see "which tickets are waiting on
a human" for the ANSWER-*.md workflow this runbook is documenting will see
nothing — the PWA has no code path that surfaces that state at all. This is
not a style nitpick: it is the runbook's own stated purpose (offline reading
of pending questions) describing a capability that does not exist, which
would send a human down a dead end when they're specifically relying on this
doc while away from Telegram.

## Why this is a bounce, not a rule_proposal

A correctness defect the architect can see is a send-back, not a
`rule_proposal` (BL-333's lesson) — this rule applies to factual/documentation
defects exactly as much as to code defects: a docs parcel with a false claim
ships exactly as broken as a docs parcel with wrong code, and a rule_proposal
alone would not stop it from reaching QA and `main` before anyone re-reads it.

## Remediation direction (not prescriptive — coder's call on wording)

Drop the PWA half of claim 1 (or clearly caveat it as *not yet* surfacing
pending-question state), and rely on the `backlog/topics/*.json` half only,
which is accurate. If the intent is for the PWA to eventually show pending
questions, that is a separate, unspecced feature — do not describe it as
already working. Re-verify the corrected wording against `pwa/app.js`'s actual
fetch list and rendered fields before resubmitting.

## Scope check

Neither `bab3abd520` nor `f54f49ef46` has this evidence file's finding as an
ancestor — this is the first time it has been raised for BL-441.
