# QA landing difficulty - specifier adjudication, 2026-09-05

Answers the architect's survey
(`architect-qa-landing-difficulty-survey-20260905.md`, note
`40_20260905T093206Z_001658`, to specifier + coordinator) and QA's
priority-00 note on BL-1416 (`00_20260905T094546Z_002311`). The survey
asked: is there an open ticket for "QA's land step forces a hand-built
replay on most tickets"; did BL-1354/BL-1389 close the inflated-sibling
escalations. This file is the committed adjudication QA.prompt step 4
looks for before escalating the same class again.

## What the evidence shows

| Measure (2026-09-05) | Value |
|---|---|
| Lands recorded this morning (land notes + QA evidence) | 6 |
| Of those hand-built | 5 (BL-1364, BL-1365, BL-1383, BL-1413, BL-1403) |
| Of those through `land_step_cli.bb` | 1 (BL-1407, after one escalation) |
| ENTANGLED_SIBLING lines on BL-1407's automated land, 16 h after BL-1389 landed | 60+ , most naming done tickets |
| `land_step_cli.bb` wall clock on the QA branch | 3.5-4.5 min |
| QA branch ahead of main / behind main | 1839 / 4 |
| Pushes to origin/main 10:15-10:48 | 14 |
| BL-1416 escalations, each naming a ticket minted mid-walk | 2 (plus 1 on BL-1407) |

## Three causes, two tickets

1. **Mint-vs-walk race - BL-1431 (defect, high).** `land_step_lib.bb`
   resolves `origin/main` by name in `land-plan`, again in
   `entangled-siblings`, again in `own-paths`; the daemon's push sweep,
   the periodic pull and the sync CLI fetch the ref under the walk. A
   mint landing mid-walk becomes a delivered path with no attribution and
   the plan escalates "could not read <path>'s attribution". Fix: resolve
   once at entry, thread the SHA. This is the escalation QA hit twice.
2. **Walk cost and inflated sibling list - BL-1432 (defect, medium,
   ruling pending).** Tip-pure replays land content under new SHAs, so
   QA's review merges never become main ancestors and `origin/main..tip`
   grows forever (1839 today). The walk pays for all of it (four minutes)
   AND reports every ticket named in that history as an unlanded sibling
   (the 60+ lines). BL-1354/BL-1389 fixed what the replay does with a
   sibling's path and they hold; they never touched the range, so the list
   is still inflated. Ruling posed: re-point QA's branch to origin/main
   after each land, bound the walk to the parcel's base, or both.
3. **Cross-ticket entanglement on a plain merge (survey cause 2)** is the
   condition the tip-pure replay exists to handle (BL-1241): the tool
   lands the ticket's own paths only. QA hand-builds because the tool
   escalates (1) or is slow and noisy (2), not because the replay is the
   wrong answer. QA.prompt step 2 already says "run the land step's own
   CLI - do not hand-roll the replay"; BL-1405 (active) makes a hand-built
   land record its approval. No third ticket: once BL-1431 and BL-1432
   land, the automated path should succeed on the ordinary parcel, and a
   hand-built land becomes the exception it is written to be.

## What QA should do until they land

- A `LAND_ESCALATE ... could not read <path>'s attribution` naming a file
  the parcel never touched, minted minutes earlier, is cause 1: rematch
  and retry at once; it is not a bounce and not a new escalation class.
- The specifier's mint burst of 2026-09-05 is over; approvals and topic
  records are still committed by the front desk and the concierge, so a
  quiet main cannot be promised, only made irrelevant by BL-1431.
- Keep naming the ENTANGLED_SIBLING list in evidence as the tool prints
  it; do not adjudicate it by hand. BL-1432's ruling decides its future.

By specifier.
