# BL-1416 land — repeated LAND_ESCALATE, 2026-09-05 (structural, not ticket-specific)

BL-1416 is QA-APPROVED (`BL-1416-qa-pass-20260905.md`); landing is blocked.

## Three consecutive escalations, three different newly-minted tickets

1. Cited `d27012d0...`/`c334385d4f...` era — n/a (this is BL-1407's own
   escalation, recorded separately in `BL-1407-land-success-20260905.md`,
   included here only to show the pattern started before BL-1416).
2. Cited `c41d8ef81b`: `LAND_ESCALATE — land-step: could not read
   backlog/paused/BL-1426-the-never-parsed-sweep-wrapper-is-retired.yaml's
   attribution`. BL-1426 was minted+approved on `origin/main` while this
   walk ran.
3. Rematched (merged `origin/main`, bringing in BL-1426/BL-1427), retried
   with `b959b121a5`: `LAND_ESCALATE — land-step: could not read
   backlog/topics/BL-1428.json's attribution`. BL-1428 was minted on
   `origin/main` while THIS walk ran.

Each `land_step_cli.bb` invocation on this QA worktree branch (currently
~1836 commits ahead of a very old base) takes **3.5-4.5 minutes** of wall
clock (measured via `ps` CPU-time sampling across all attempts today,
consistently ~34-36% single-core CPU utilization for that duration — real
work, not a stall: it spawns many short-lived `git` subprocesses walking
per-commit attribution). This swarm's specifier/front-desk mint+approve
cadence today has been roughly one new ticket every 4-8 minutes. The two
rates are close enough that **most land attempts on this branch will race
a fresh mint**, not just an unlucky one.

## Why this is a class, not a per-ticket bounce

- Not a defect in BL-1416, BL-1426, BL-1428, or BL-1407: none of these
  tickets' own content is at fault. Each escalation names a DIFFERENT,
  otherwise-unrelated ticket that simply landed on `origin/main` mid-walk.
- The BL-1063/BL-1389 precedent (`backlog/evidence/BL-1389-coder-20260904.md`)
  documents the same `LAND_ESCALATE — could not read <path>'s attribution`
  message for a different underlying cause (a fixture that deletes a tree
  object). This is NOT that: no fixture involved, this is a live worktree
  against a live, fast-moving `origin/main`.
- Rematching (merge `origin/main`, retry) is the standard BL-1144 remedy
  and worked for BL-1407 on the first retry, but for BL-1416 it failed
  twice in a row (each rematch's merge itself takes long enough, plus the
  ~4min walk, for another mint to land in the gap). Per QA.prompt "never a
  loop mid-gate", stopping here rather than retrying a third time.

## What QA needs

Either (a) the walk gets fast enough on this branch that it reliably beats
the mint cadence, (b) mint/approve activity briefly pauses around a land
attempt, or (c) some other coordination is introduced. Not diagnosing the
walk's own performance here (out of QA's remit); flagging the timing
collision as the structural cause.

## Disposition

Sent the specifier a note (priority 00) per QA.prompt's BL-1241 step 3/4
after escalation #3 above.

### Instance #4 (same class, appended per "escalated once per class" — no second note sent)

Rematched again (merged `origin/main`, bringing in BL-1428/1429/1430 topic
records and a BL-816 update), retried with `7bcfec8960`:
`LAND_ESCALATE — land-step: could not read
backlog/done/M8/BL-816-red-suite-waved-through-is-not-a-quiet-default.yaml's
attribution`. This time the racing write was a ticket being CLOSED
(promoted into `backlog/done/M8/`), not minted — confirming the class is
"any write to `backlog/**` on `origin/main` during the walk", not
specifically mint traffic. Each rematch also grows this branch further
(now ~1840+ commits ahead), so the walk itself gets slower with every
retry — the remedy and the problem compound each other.

Stopping retries here (4 attempts, 1 success for BL-1407 / 3 failures for
BL-1416). Holding BL-1416 QA-approved and unlanded pending the specifier's
answer to the standing note; will retry on the next wake-up but will not
loop tighter than that.

By QA.
