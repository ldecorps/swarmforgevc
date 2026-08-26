# BL-979 — coder findings

The pivot itself was mechanical. What was not: the blast radius across four
OTHER tickets' acceptance contracts, and separating the reds this parcel caused
from the ones that were already there.

- **Author**: coder, 2026-08-21.

## What the pivot changed

`renderGridMatrixLines` transposes: a single stage-glyph header over one line
per ticket. The dropping axis moves with it — `PIPELINE_BOARD_GRID_MAX_ROWS`
(new, 12) drops the tail and announces `+N more active`;
`PIPELINE_BOARD_GRID_MAX_WIDTH` (30, unchanged) stops being a dropper and
becomes an assertion, because width is now a constant of the stage set. The
caption block gains `-- <epic-slug> --` separators with a blank line before
every summary, epic-less last, and no separators at all on a wholly epic-less
board.

Both render paths — plain text and the live Telegram HTML — already routed
through one `renderGridLines`, so the BL-956 lockstep hazard did not apply.

Rendered shape at 4-digit ids (28 chars, inside the 30 budget):

```
     NS SP CO CL AR HD DC QA
 948  .  .  X  .  .  .  .  .
1010  .  .  .  .  .  .  .  X

-- code-quality-gates --

948 socket fixture roots exceed the sun_path limit

-- (no epic) --

1010 a secondary swarm publishes under its own name
```

## The row budget of 12 is a judgement, not a derivation

The ticket fixed the *posture* (a visible budget with a `+N more active`
tail-drop) and left the number open. 12 is roughly double BL-585's effective 7,
which is the point — height is cheap where width was not — while still bounding
the `<pre>`: header + 12 rows + two caption lines apiece stays inside one phone
scroll and nowhere near the 4000-char message limit. Say the word if a different
number is wanted; it is one constant.

## Pre-pivot reds resolved (the ticket's "no standing pre-pivot reds" line)

| feature | before | after | what was done |
|---|---|---|---|
| BL-585 ticket-column matrix | 3/14 | **8/8** | retired sc01/03/04, transposed sc02/05/07 |
| BL-956 caption-and-cap | 5/6 | **5/5** | retired sc03 |
| BL-979 (this ticket) | no handlers | **10/10** | handlers written, all six scenarios |

Retired, never reworded, per the Consolidation Authority the sibling ticket
BL-1006 cites: restating BL-585 sc01 for the new axis would just duplicate
BL-979 sc01 inside BL-585's file.

Each retirement was checked against "deletes an obsolete claim, never a live
check". **BL-585 sc02 was NOT retired for exactly that reason** — it is the only
place the holder→stage mapping is asserted end-to-end, including a
coordinator-held ticket rendering at QA and an unheld one at NS, which BL-979's
own feature file does not re-assert. It was transposed instead. Likewise sc05
(a dropped ticket stays reachable in the link list — re-pointed from the width
budget to the row budget, and its fixture raised from 10 to 15 so it still
actually overflows) and sc07 (NBSP padding).

**BL-585 sc03 was already red before this parcel** — BL-956 replaced epic
captions with title captions and left it behind. It was retired here because it
is the same class, its successor (BL-979 sc06) is green, and it was sitting in a
file this parcel was already rewriting. Flagging it as a scope judgement rather
than burying it.

## Pre-existing reds SURFACED, not fixed (verified at HEAD, not assumed)

Both changed files were restored to `HEAD`, recompiled, and the features re-run.
Byte-identical outcomes, so none of these belong to this parcel:

| feature | at HEAD | with this parcel | verdict |
|---|---|---|---|
| BL-455 epic grouping / parked slug | 5 pass / 3 fail | 5 pass / 3 fail | **unchanged — pre-existing** |
| BL-465 board render round 2 | 8 pass / 1 fail | 8 pass / 1 fail | **unchanged — pre-existing** |
| BL-526 miniapp console menu | 0 pass / 1 fail | 0 pass / 1 fail | **unchanged — pre-existing** |

BL-455's three and BL-465's one are the same class this ticket and BL-1006 both
address: acceptance artifacts pinning a layout that later slices replaced
(BL-455's per-ticket pivoted blocks; the grid slug column BL-956 replaced with
the title). BL-526's is unrelated — "expected exactly two primary buttons, found
6", nothing to do with the grid.

Not fixed here: they are other tickets' work under BL-506, and absorbing them
would have hidden them. **No ticket tracks any of them yet** — worth one, filed
together with BL-1005 and BL-1006 under `code-quality-gates`.

## Verification

- Unit — `pipelineBoard.test.js` + new `bl979PipelineBoardTicketRows.test.js` +
  both sync suites: **194 pass**. Twelve stale pre-pivot assertions in
  `pipelineBoard.test.js` were re-expressed in the same parcel (BL-949).
- Property — both of BL-979's declared invariants are encoded in
  `pipelineBoard.property.test.js`, superseding the BL-585 property that lived
  there, with **constructed** reachability floors (over/under budget, four id
  widths, three epic mixes) asserted as floors rather than hoped for. Shown
  failing against two targeted breaks: removing the row budget → "only the row
  budget may drop a row"; captioning all rows instead of visible ones → "the
  caption list covers exactly the visible rows". BL-956's own cap invariant was
  re-pointed from the width formula to the row budget.
- Acceptance — BL-979 10/10, plus the whole board family green except the three
  pre-existing reds above.
- Registry — `bl800StepRegistryScopingConsistency`, `acceptanceContractGate`,
  `bl968StepRegistryMaterializedTreeGuard`, `bl1005OnboarderBuildStateGate`: all
  pass with the new domain registered.

**`qa_e2e_procedure` step 7 is not done and cannot be done here**: it asks for a
real board posted to the Telegram pipeline topic and read on a phone, with the
screenshot attached. That needs the live bridge and a human holding the phone.
Everything checkable without them is above; the phone check remains open for QA.
