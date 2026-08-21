# BL-990 — coder findings

The ticket's diagnosis held. The one thing it under-stated is how far
"every consumer" reaches.

- **Author**: coder, 2026-08-21.

## The four consumers do not share a reader — they use three

The ticket lists `qaBounceStore`, `failureModeInventory`, `reworkRounds` and
`leanLedgerComposeBounce` as consumers "of the store", which reads as one place
to resolve supersession. Measured instead of assumed, it is **three independent
paths**:

| path | who | reads |
|---|---|---|
| `bounceStore.readBounceRecords` | reworkRounds, costHealthSidecar, qa-bounce-line, and the recorder's own dedup | the merged `qa_bounces/` + `bounces/` JSONL |
| `failureModeInventory.recordsFromQaBounceJsonl` | the failure-mode audit | parses the JSONL **itself**, never through the store module |
| `leanLedgerComposeBounce.composeBounceEvents` | the ticket lifecycle ledger | the **ticket YAML's `bounce_history`**, not the JSONL at all |

A correction resolved only in `readBounceRecords` would have left two consumers
reporting the original attribution — precisely the "two different bounce rates
from one store" the constraints call out as worse than today's single wrong
number. All three now resolve it.

For the YAML path the correction is resolved FROM the JSONL store rather than
mirrored into the YAML by a second writer: one source of truth, nothing to
drift.

## A dedup trap the ticket did not name

`appendBounceRecordIfNew` deduped against `readBounceRecords`. Once that
excludes corrected records, a corrected bounce becomes invisible to the dedup
and a re-run appends it again — silently resurrecting the very attribution the
correction removed. The append path now dedups against a new
`readRawBounceRecords`; the corrected view is for attribution only.

## Design call: excluded-from-attribution, not "blame the specifier"

The ticket left this open and called the second option smaller. Taking it, and
here is the reason beyond size: `KNOWN_PRODUCING_ROLES` is the closed set every
consumer **groups on** (`qa_bounce:<class>:<role>` signatures, role tallies, the
legacy store's shape). Adding a member would ripple through all of them to say
something the exclusion already says — this bounce is not evidence about the
role it names. `--by` already accepts `specifier`, so the correction still
records who issued it.

`--role` was not widened and no enum was touched.

## What is deliberately NOT wired

`record-bounce-correction.js` exists and works, but **no role prompt mentions
it yet**. A correction verb nobody is told about will not be used, and the
prompt text is the documenter's stage on this very ticket — flagging it here so
it is a decision rather than an omission. QA is the natural caller: QA issued
the real correction as a note on 2026-08-20.

One scope note: `recordsFromQaBounceJsonl` resolves corrections found **within
the content it is handed**. Its CLI passes one file, so a correction written in
a later month than its bounce would not be seen by that consumer. The other two
paths read the whole store and are unaffected. Not fixed here — it needs the
inventory CLI to take a directory, which is its own change.

## Verification

| check | result |
|---|---|
| pure core (`bl990BounceCorrection.test.js`) | 11 pass |
| store + all three read paths (`bl990BounceCorrectionStore.test.js`) | 11 pass |
| declared invariants (property) | pass, 250 runs |
| BL-990 acceptance | **8/8** |
| sibling contracts BL-635 / BL-512 / BL-608 / BL-689 / BL-819 / BL-954 | 15 / 8 / 6 / 10 / 12 / 6, all green |
| unit regressions (bounceStore, failureModeInventory, leanLedger, bounceHistory, bounce, backfill) | 77 pass |
| consumer regressions (costHealthSidecar, reworkRounds) | 111 pass |
| bounce property regressions (naturalKey, keyPairArb, history, BL-689) | 21 pass |
| registry (bl968, bl800, acceptanceContractGate) | pass with the new domain |

**Both declared invariants are one coder-authored property** with constructed
reach: corrections are DERIVED from bounces actually in the store (a randomly
generated correction would essentially never name a real one, and the property
would pass having tested nothing), with a deliberate fraction aimed at absent
bounces so the inert case is reached too. All three categories have asserted
floors. Invariant 1 is checked against **both** JSONL readers, since they are
separate implementations.

Non-vacuous in both directions:

| break | property says |
|---|---|
| `failureModeInventory` ignores corrections | "failureModeInventory — a separate parse — agrees exactly with readBounceRecords" |
| `readBounceRecords` ignores corrections | "readBounceRecords withdraws exactly the corrected bounces" |

**The acceptance is non-vacuous per consumer too.** Scenario 02 only ever asks a
consumer for its reading AFTER the correction, so "it reports 0" would pass just
as happily against an adapter wired wrong enough to always report 0 — the
green-when-broken shape this ticket is itself an instance of. The Background
therefore builds an **uncorrected twin** of the same fixture, and each consumer
must report the bounce against the twin before its zero counts.

`qa_e2e` step 4 (replaying the real BL-971 record) is left for QA: it wants the
live `.swarmforge/bounces/` store, which this parcel must not write to.
