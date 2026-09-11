# Turn-profile producer wiring (BL-1364)

*How-to. BL-664 shipped the walker (`transcriptWalker.ts`) and the series
builder (`turnProfile.ts`'s `buildTurnProfileSeries`), but nothing called the
series builder — the "mechanical share of a turn" measurement two epics
(BL-667, BL-668) sequenced themselves behind never produced a number. BL-1364
wires a producer, following the sibling BL-665 context-telemetry shape.
BL-1476 then bounded the producer's own read cost — see "Bounded reads"
below.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Core producer | `extension/src/metrics/turnProfileProducer.ts` | Walks role transcripts via BL-664's `transcriptWalker`, folds them through `buildTurnProfileSeries`, dedupes by window |
| Summary store | `extension/src/metrics/transcriptSummaryStore.ts` | Persists one verdict per transcript path (BL-1476) — see "Bounded reads" |
| Headless CLI | `extension/src/tools/run-turn-profile-producer.ts` | One-shot producer run for operators and acceptance |
| Scheduled tick | `swarmforge/scripts/handoffd.bb` | `turn-profile-producer-sweep!`, defined directly after `context-telemetry-producer-sweep!` (deliberately — a sweep defined above its dependencies still loads and registers, then throws the first time it fires; BL-1392); a non-zero exit is logged as `turn-profile-producer-failed` with the exit code and first stderr line (BL-1478) |
| Write path | `.swarmforge/telemetry/turn-profile-series.jsonl` (`turnProfileStorePath`) | One JSON record per window, appended directly — no separate CLI wraps this store yet |
| Summary store path | `.swarmforge/telemetry/turn-profile-transcript-summaries.json` (`turnProfileSummaryStorePath`) | Per-transcript `{size, mtimeMs, unreadable, truncatedTail, intervals}`, keyed by absolute path (BL-1476) |

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

## Bounded reads (BL-1476)

Before BL-1476, every tick re-listed and re-read every transcript ever
written under each role group's transcript directory — no time bound, no
cursor — so a tick's cost grew with lifetime session volume, not with what
changed since the last tick (2.2 GB / 27-39 s measured on 2026-09-07, inside
a `SUPERVISOR_IN_SWEEP_BUDGET_MS` of 225 s and a 60 s subprocess wait bound).

- **Summary store.** `transcriptSummaryStore.ts` persists one
  `TranscriptSummary` per transcript path
  (`.swarmforge/telemetry/turn-profile-transcript-summaries.json`): `size`,
  `mtimeMs`, the readability verdict, and the raw per-file walk intervals. A
  tick stats every listed transcript; a file whose size and mtime still
  match its summary costs one stat and is never re-read or re-parsed. A path
  no longer listed has its summary dropped, not carried forward. This
  replaces the old two-full-reads-per-file-per-tick shape (one read for
  readability, one for the walk) with one read per changed file.
- **What gets recorded never changes.** The summaries only change what is
  *read*; a completed tick's window row is byte-for-byte what a full walk of
  the same transcripts would have produced at that moment (same
  `window_day`, `complete`, `unreadable`/`truncated-tail` lists, stage
  shares).
- **Tick deadline.** The CLI reads `TURN_PROFILE_TICK_DEADLINE_MS` (default
  30000) from the OS env, clamped to at most a quarter of
  `SUPERVISOR_IN_SWEEP_BUDGET_MS` (default 225000, so 56250 ms) —
  `resolveTurnProfileTickDeadlineMs` in `run-turn-profile-producer.ts`. The
  deadline is checked only before a read that is actually needed, never
  before an unchanged file's stat.
- **Partial tick.** If the tick reaches its deadline before finishing the
  walk, it persists the summaries it completed so far and writes **no**
  window row that tick — a partial window is not a measurement, the same
  fail-closed posture BL-1364 chose for an unreadable transcript. The next
  tick picks up from the persisted summaries and finishes.
- **Read-of-listed report.** Every CLI output line now reports how many
  transcripts it read of how many it listed (`read <N> of <M>`), the live
  evidence for the bounded-read invariant that QA and the daemon log can see
  without a seam.
- **Out of scope here.** The sibling `context-telemetry-producer-sweep!`
  shares the same unbounded-read shape but has been silently throwing on a
  corrupt store line since 2026-08-30 (BL-1477); adopting this change
  detection there is the epic's recorded follow-up once BL-1477 un-darkens
  it.

## Manual run

```bash
cd extension && npm run compile
node extension/out/tools/run-turn-profile-producer.js
```

Expect one of: `RECORDED`/`UPDATED turn profile for N stage(s): ... (read <N>
of <M>)`, `SKIPPED no classified turns in the window (read <N> of <M>)`,
`INCOMPLETE window has unreadable transcripts; no stage reports a share (read
<N> of <M>)`, or `PARTIAL read <N> of <M>; no window recorded this tick`.
Re-running over the same transcripts is idempotent — no duplicate window
records, and (after the first complete run) only newly-changed transcripts
are read.

## Verify

```bash
cd extension && npm test -- turnProfileProducer run-turn-profile-producer transcriptSummaryStore
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1364-the-mechanical-share-of-a-turn-is-readable.feature
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1476-the-turn-profile-sweep-reads-only-what-changed.feature
```

## Out of scope

Reading the series (the briefing and the closing-ceremony packet — BL-1365 —
are both plausible first consumers; neither slice blocks the other). Changing
what the walker classifies or its category set — that is BL-664's, untouched
here.

Related: [BL-665 context-telemetry producer wiring](BL-665-context-telemetry-producer-wiring.md)
(the sibling shape this producer follows).
