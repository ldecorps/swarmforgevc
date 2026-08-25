# INTAKE — Frequent QA push races on main land (rematch storm)

**Source:** human via Cursor, 2026-08-25 ~20:38 BST  
**Priority:** queue-jump — burns QA wall-clock and cascades tip-purity bounces  
**Status:** new intake, not minted.

## Why this is in front of you

Human report (verbatim this session): **"I get push raced all the time."**

Live QA pane on Cursor Auto (worktree `.worktrees/QA`) shows the standing
pattern: gates finish green / tip still pure → `git fetch origin main` →

> Push raced with BL-989 close – recovering tip and re-landing the approve.

Evidence of the same event on the same evening:

- `backlog/evidence/BL-999-qa-pass-20260825.md` — re-landed after push race
  with BL-989 close `ed9902287`
- `backlog/evidence/BL-1100-qa-bounce2-20260825.md` / bounce3 — tip lost
  ancestry / raced by BL-988 bookkeeping or assignment land during the QA
  gate window

Recent `origin/main` subjects are a bounce cascade across parallel actives
(`BL-988` / `BL-999` / `BL-1100` / `BL-1124` / closes): each successful land
dirties peers still in gates → rematch → another race.

Rematch recovery itself is working (BL-1130 / BL-1131 / BL-1138 / BL-1141
path). The defect is **frequency**: concurrent writers to `origin/main`
(QA lands + coordinator closes + peer bookkeeping) while long QA gate
windows hold a tip based on a stale base. Recovery is not a substitute for
reducing contention.

## Goal

Mint one ticket that **materially reduces push-race / tip-purity rematch
storms during approve→land**, without regressing tip purity or the
rematch-then-FF absorb path.

Specifier chooses the mechanism; acceptable directions include (one or a
coherent small set — do not mint a kitchen-sink epic unless needed):

1. **Serialize publishers to `origin/main`** — a land/close lock or single
   publisher so a second land waits or rematches once at the lock edge,
   not mid-gate after a peer already pushed.
2. **Late tip rematch at publish** — fetch + tip-pure rematch immediately
   before the land push (so gate-time purity is advisory; publish-time
   purity is authoritative), with bounded retry on race.
3. **Coordinator close / bookkeeping deferral** while a QA land is in
   flight (or batch closes after lands), so "Close BL-N" stops racing the
   approve that just finished gates.
4. **Cap concurrent tickets in QA / land** so N parallel rematch loops
   cannot amplify each other.

Whatever ships must leave durable evidence that races are rarer under a
realistic multi-active load (not only that rematch still works).

## Locked human decisions

1. This is a **fix**, not ops advice to "run fewer tickets."
2. Do **not** reopen BL-1130 / BL-1131 / BL-1135 / BL-1138 / BL-1141 — those
   made races recoverable / absorb-safe. New id for **contention /
   frequency**.
3. Tip purity vs `origin/main` remains mandatory for landed tips — do not
   "fix" races by allowing impure lands or force-push.
4. Designed recovery on a residual race stays rematch lander / rematch
   bookkeeping — never "page human to finish merge" (BL-1130 invariant).
5. Prefer queue-jump / priority 0 once minted — this tax hits every parallel
   QA pass tonight.

## Out of scope

- One-shot rematch of today's tip / clearing standing deadlock (ops)
- Push-sweep QA-refusal cache (separate intake already filed if still open)
- Weakening BL-630 QA-approval gate or BL-855 noop-landing-merge refuse
- Treating the five× `ready_for_next.sh` handoff-mail spam as this ticket
  (symptom of retries; may be a named follow-on if still loud after races drop)

## Related

- Live symptom: QA Auto pane; evidence `BL-999-qa-pass-20260825.md`,
  `BL-1100-qa-bounce{2,3}-20260825.md`
- Land/rematch stack (done, do not regress): BL-891, BL-1120, BL-1130,
  BL-1131, BL-1135, BL-1138, BL-1141
- Docs: `docs/how-to/BL-1130-land-on-main-without-external-conflict-resolution.md`,
  `docs/how-to/BL-1131-ticket-land-without-operator-absorb-merge.md`
- Human session: Cursor Auto "Qa on Cursor Auto" — push race with BL-989 close

## Acceptance sketch

1. Spec + feature name the contention defect and the chosen control
   (lock / late rematch / close deferral / concurrency cap — whichever
   specifier locks).
2. Under a fixture or harness with ≥2 concurrent land/close publishers,
   a second publisher does not produce unbounded tip-purity bounce loops;
   residual races rematch once and land FF (or wait on lock) without human
   absorb.
3. How-to (or Spec note) documents the new land discipline for QA /
   coordinator so the next race storm is diagnosable as a regression.
4. Intake drained when the ticket is minted; do not soft-mint without
   filling acceptance.
