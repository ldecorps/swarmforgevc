# Recording a suite's failure set once per base commit (BL-1377)

## What it saves

Showing that a red is pre-existing (BL-1063) means running a suite twice —
once at the parcel's base, once with the parcel — and comparing. The base
half of that answer is the same fact for every stage sitting on the same
base commit, yet coder, cleaner, hardener and QA each re-ran it. Measured
on BL-1375's coder pass (2026-09-03): `npm run test:properties` (143s) and
`npm test` (~30s), each run twice, to write one evidence sentence.
`suite_baseline.sh` records the base half once and lets a stage with a
fresh record run the suite only once (with the parcel) and diff against it.

## Usage

Run this **instead of** the bare suite command in the evidence step — one
substitution, not a new habit:

```
swarmforge/scripts/suite_baseline.sh <suite> [--base <sha>] [--recorded-by <role>] [--json]
```

`<suite>` is `unit` (`npm test`) or `properties` (`npm run test:properties`)
— the two suites this covers. `--base` defaults to `merge-base HEAD
origin/main`. The last line printed is the evidence sentence to paste
straight into a role's evidence file.

A cache hit reads:

```
suite properties at base <sha> (baseline recorded by coder): 3 recorded reds, 3 observed reds, same set - baseline reused, base run skipped.
```

A miss (no record, unreadable record, or config hash mismatch) runs the
base suite too and reads:

```
suite properties at base <sha>: no baseline record for this suite at this base; running the base suite as well to settle it.
```
— naming any `new:`/`vanished:` sets when the second run finds a mismatch.

## The two invariants

1. **A record can only ever excuse a red it actually names**, at the same
   base sha and the same config hash. A red the record doesn't name is
   new, and the diff says so — the cache can shrink a run, never widen an
   excuse.
2. **Absent, unreadable, or config-mismatched record falls back to today's
   two runs.** No path through this turns a missing baseline into a green.

The record key is `{suite, base-sha, config-hash}` — a SHA-256 digest over
each suite's own config files (`extension/vitest.config.mjs` /
`extension/package.json` for `unit`; those plus
`extension/vitest.properties.config.mjs` and the property-suite standing
allowlist for `properties`). A config file going missing moves the hash
too — deleting it must never leave an old record still matching.

## Where it runs the base half

The base suite runs in a **throwaway worktree** at the base sha
(`.worktrees/suite-baseline-<sha>`, removed in a `finally` and swept by
prefix beforehand per BL-971) — the calling stage's own worktree HEAD is
never touched to measure something. Records live at
`.swarmforge/suite-baselines/<suite>.jsonl`, one JSON line per observation;
a single unparseable line makes the whole file unreadable (falls back to
two runs) rather than being silently skipped, since dropping a line is how
a record could shrink into a smaller excuse.

## Out of scope

What counts as a pre-existing red (BL-1063's own rule, and BL-1175's
standing allowlist) — this caches the *observed* failure set and changes
nothing about what the allowlist tolerates. Making the suites themselves
faster (BL-1348, BL-1349).

Acceptance: `specs/features/BL-1377-a-suites-failure-set-is-recorded-once-per-base-commit.feature`.
