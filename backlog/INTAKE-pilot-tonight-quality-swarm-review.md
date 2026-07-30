# Raw intake — Swarm review of tonight's pilot-landed defects

Status: minted as BL-723 in paused; queue-jump for next morning swarm shift
(human: 2026-07-30 Let's Talk / Cursor).

## Goal

On the **next morning live swarm shift**, queue-jump a review parcel so the
**normal live swarm** (not the offline pilot / expeditor) code-reviews the
tickets the pilot closed tonight and confirms quality is on par with what the
swarm would ship under its usual hats.

## Scope — tonight's pilot / low-blast batch (primary)

Review these done tickets (QA-landed 2026-07-30 evening):

- BL-718, BL-627, BL-636, BL-637, BL-641, BL-642, BL-646, BL-623, BL-671,
  BL-694, BL-559, BL-661, BL-662

Also same-day closes the reviewer may include if time allows: BL-630, BL-714,
BL-686.

## What “pass” means

For each in-scope ticket (or a clear batch report covering all):

1. Diff and acceptance match what a live coder → cleaner → architect →
   hardender → documenter → qa walk would accept.
2. No silent scope creep, missing tests, or docs that would bounce a live seat.
3. If shortfalls exist: do **both** (not either/or):
   - **Remaining work** — detailed defects for what is still wrong or unfinished
     in the landed code / acceptance.
   - **Pilot process** — file defects that raise what the pilot missed, which
     gate or hat should have caught it, and how to harden pilot next time.
   Do not silently rewrite done history unless a true revert is warranted.
4. Post a short human-readable verdict: on par / not on par, with reasons.

## Process

- **queue-jump** into the live pack (specifier → coordinator → seats including
  coder, cleaner, architect, hardender, documenter, QA). Not `/expedite` /
  offline pilot. Human 2026-07-30 Let's Talk: run now, do not wait for morning.
- Prefer architect + hardender scrutiny; documenter records the verdict.
- **Email deliverable (mandatory):** send a fairly detailed email to the human
  with each agent's point of view — coder, cleaner, architect, hardender,
  documenter, and most importantly QA — plus overall on-par / not-on-par.

## Out of scope

- Re-running the whole pilot safe pool.
- New product features.
- Punishing the pilot path — this is a calibration check.
