# BL-1338 LAND_ESCALATE — specifier adjudication — 2026-09-02

Inbound: QA note `002129_from_QA_to_specifier` ("11 entangled unlanded
siblings, see evidence") over
`backlog/evidence/coordinator-bl1338-land-escalate-facts-for-adjudication-20260902.md`.

## Ruling

**No spec defect in BL-1338.** Its spec, scenarios and acceptance contract are
sound and nothing in them needs amending. The blocker is machinery, and QA was
right not to force-land.

**Minted BL-1343** (`backlog/paused/`, severity high, epic swarm-reliability)
for the real blocker. Verified by hand before minting, not taken from the
escalation:
- `origin/main:specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js` —
  absent. At `bc1a587622` — present.
- `git diff --name-only origin/main bc1a587622 | grep 1338` — eight paths.
- Yet the replay reported own-paths identical to origin/main.

One cause under both of the coordinator's first two findings: a replay-landed
sibling's content reaches main as a NEW commit object, so nothing attributes
to its original SHA. `sibling-landed?` correctly refuses to infer landed-ness
from that silence (BL-1272 invariant 1) — that is what inflates 3 real
entanglements to 11 — and the same silence on the other side of `own-paths`'
subtraction is what credited BL-1338's own paths to those siblings.

## Not re-minted

- **BL-1272** — the fail-closed sibling rule is behaving as designed, not
  broken. Separately: its 2026-08-30 `status: blocked` note said the block
  clears once BL-1297 lands and its content reaches main. Both have happened
  (`origin/main:land_step_lib.bb` carries 3 BL-1272 mentions). Confirmed as
  that note asked. Moving it to `done/` is coordinator bookkeeping, not mine.
- **BL-1309** — a different step (`land_main_publish.sh` never asking what the
  tip carries).
- **BL-1332** — the mirror case (a shared path taken whole, leaking a
  sibling's adjacent line IN). Separately ruled option 1 by the human.
- **BL-1297** — done; fixed a merge commit's own paths being empty, which is
  not this attribution.

## Coordinator finding 3: overstated, and the correction matters

The claim that `main` is red because BL-1338's live `.feature` has no handler
does not hold repo-wide, and acting on it would be a wrong fix:

- `specs/pipeline/generated/` is **gitignored and untracked** (`.gitignore:28`;
  `git ls-files specs/pipeline/generated` -> 0). The 72 files in any given
  checkout are local leftovers.
- `specs/pipeline/scripts/run_acceptance.sh` and `specs/pipeline/cli.js` take
  **one feature file** per invocation. Nothing enumerates `specs/features/*`.
- The BL-761 gate's `resolve_contract_steps.js` runs per-ticket, against a
  step-registry tree materialized at the ticket's own cited commit.

So an unregistered feature on `main` throws only for whoever runs THAT
feature — BL-1338's own parcel, where the handler exists on the QA branch. It
is a real per-parcel hazard and the handler must land with the fix; it is not
a new red on `main` and not a cause of any other parcel's failure. This
matches the standing mint practice (BL-1333, BL-1342 both carry live
`.feature` files awaiting their handlers).

## What is authorized, and what is not

- BL-1338 stays `active/` and unlanded. Correct.
- Landing it is blocked until BL-1343 lands, or until a human/coordinator
  routes it through `swarmforge/scripts/expedite.sh` — the expeditor exists
  for a defect in the delivery machinery that cannot ride the lane it repairs
  (BL-567). That is a routing call, not the specifier's.
- BL-1343 is paused and carries `human_approval: pending`. Promotion order is
  the coordinator's; it is a `high` defect, so Article 3.2.4's expedite lane
  applies once approved.

By specifier.
