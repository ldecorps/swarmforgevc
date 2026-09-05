# Turn-profile producer wiring (BL-1364)

*How-to. BL-664 shipped the walker (`transcriptWalker.ts`) and the series
builder (`turnProfile.ts`'s `buildTurnProfileSeries`), but nothing called the
series builder — the "mechanical share of a turn" measurement two epics
(BL-667, BL-668) sequenced themselves behind never produced a number. BL-1364
wires a producer, following the sibling BL-665 context-telemetry shape.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Core producer | `extension/src/metrics/turnProfileProducer.ts` | Walks role transcripts via BL-664's `transcriptWalker`, folds them through `buildTurnProfileSeries`, dedupes by window |
| Headless CLI | `extension/src/tools/run-turn-profile-producer.ts` | One-shot producer run for operators and acceptance |
| Scheduled tick | `swarmforge/scripts/handoffd.bb` | `turn-profile-producer-sweep!`, defined directly after `context-telemetry-producer-sweep!` (deliberately — a sweep defined above its dependencies still loads and registers, then throws the first time it fires; BL-1392) |
| Write path | `.swarmforge/telemetry/turn-profile-series.jsonl` (`turnProfileStorePath`) | One JSON record per window, appended directly — no separate CLI wraps this store yet |

## The two invariants that shape the stored record

- **Absent, not zero.** A stage with no classified turns in the window is
  omitted from the record's stage list entirely. The producer never writes a
  `0` share for a stage that did not run — a measured zero and "this stage
  didn't work this window" must stay distinguishable in the stored shape,
  not only in whatever later renders it.
- **Fail-closed on interior damage, tolerant of a live tail.** A window
  containing a transcript with interior damage (a line that fails to parse
  with a whole line after it) is recorded `complete: false` and contributes
  no stage share at all, rather than diluting one. A **torn final line** is
  treated differently — it is a live agent still writing, not damage: the
  torn line is dropped, the transcript is named `truncated-tail` in the
  record, and the window still reports `complete: true`. Without that
  distinction, no window with any agent mid-turn could ever publish.

The category set itself is never restated here — it comes from
`transcriptWalker`'s own `INTERVAL_CATEGORIES`, re-exported as
`TURN_PROFILE_CATEGORIES`, so the two cannot drift apart (the general shape
BL-897 names).

## Manual run

```bash
cd extension && npm run compile
node extension/out/tools/run-turn-profile-producer.js
```

Expect one of: `RECORDED`/`UPDATED turn profile for N stage(s): ...`,
`SKIPPED no classified turns in the window`, or `INCOMPLETE window has
unreadable transcripts; no stage reports a share`. Re-running over the same
transcripts is idempotent — no duplicate window records.

## Verify

```bash
cd extension && npm test -- turnProfileProducer runTurnProfileProducer
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1364-the-mechanical-share-of-a-turn-is-readable.feature
```

## Out of scope

Reading the series (the briefing and the closing-ceremony packet — BL-1365 —
are both plausible first consumers; neither slice blocks the other). Changing
what the walker classifies or its category set — that is BL-664's, untouched
here.

Related: [BL-665 context-telemetry producer wiring](BL-665-context-telemetry-producer-wiring.md)
(the sibling shape this producer follows).
