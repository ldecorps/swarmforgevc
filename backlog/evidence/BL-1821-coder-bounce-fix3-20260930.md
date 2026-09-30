# BL-1821 — coder, 2026-09-30 (specifier ruling on QA D2, note 003572, amendment 2e36351598)

## What changed

Implements the specifier's ruling on QA's D2 spec-gap (evidence
ac6052db4a): the scout keeps its own seen list, never the weekly coder
path's `seen.jsonl`.

- `swarmforge/scripts/recruiter_hf_discover.py`: `SEEN_FILENAME`, read
  from `RECRUITER_SEEN_FILE` (default `seen.jsonl`, unchanged for the
  weekly coder path). `seen_ids()` reads this filename under
  `.swarmforge/recruiter/` instead of the hardcoded `seen.jsonl`.
- `swarmforge/scripts/recruiter_specifier_scout.sh`:
  - `SEEN_SPECIFIER=.swarmforge/recruiter/seen-specifier.jsonl` - the
    scout's own list.
  - The real-discovery call now sets `RECRUITER_SEEN_FILE=seen-specifier.jsonl`,
    so a live run's own `SCAN_LIMIT` scan is novelty-scoped correctly
    from the start.
  - A second filter, against the same `seen-specifier.jsonl`, runs on
    whatever `CANDIDATES_JSON` discovery returned (stub or real) - a
    stubbed discovery source (tests, and the acceptance feature) has no
    seen-awareness of its own, so this is what actually enforces the
    invariant for the acceptance scenario.
  - Mark-before-pull: each selected candidate's `hf_id` is appended to
    `seen-specifier.jsonl` BEFORE the pull is attempted (mirrors
    `recruiter_weekly.sh`'s own convention exactly) - a failing pull is
    not retried every week, and the same candidate can never ride two
    scout runs at once.
  - Doc comment updated: what the scout writes now names
    `seen-specifier.jsonl` explicitly, "never the weekly coder path's own
    seen.jsonl".
- `specs/pipeline/steps/bl1821SpecifierScoutSteps.js`: step handlers for
  the amended feature's new scenario `scout-own-seen-list-04` - marks the
  weekly coder path's `seen.jsonl` with the first candidate before either
  scout run, runs the REAL scout twice in a row, and asserts the first
  run batteries the top 3 of a 5-candidate listing, the second batteries
  the other 2, and the weekly path's `seen.jsonl` is never touched (still
  names only the one entry seeded before either run).
- `swarmforge/scripts/test/test_recruiter_hf_discover_batch.sh`: case 05,
  `RECRUITER_SEEN_FILE` scopes novelty to its own file - a candidate
  marked only in the default `seen.jsonl` is NOT filtered when a
  different file is named.

Per the specifier's own note, the how-to doc line lands with the
documenter in this same parcel - not touched here.

## Verification

- `python3 -c "import ast; ast.parse(...)"`, `bash -n
  recruiter_specifier_scout.sh`, `node -c bl1821SpecifierScoutSteps.js`:
  all clean.
- `bash swarmforge/scripts/test/test_recruiter_hf_discover_batch.sh`:
  ALL PASS (8 checks, including the new case 05). Non-vacuous: pinned
  `SEEN_FILENAME` back to the literal `"seen.jsonl"` and re-ran - case 05
  failed (the seen-specifier.jsonl entry was ignored, the default
  seen.jsonl entry filtered instead); restored, re-ran, ALL PASS.
- `bash swarmforge/scripts/test/test_recruiter_specifier_scout.sh`:
  ALL PASS (13 checks, unaffected - each fixture root is fresh, so the
  new seen-list filtering never has a prior mark to skip; test 02's "two
  runs on the same models leave exactly 2 rows" now holds because the
  second run's re-battery of the SAME candidate is itself skipped by the
  seen-list rather than because the merge replaces a duplicate row - the
  assertion, "never 4 rows", stays true either way).
- `bash swarmforge/scripts/test/test_recruiter_nightly_specifier_scout.sh`:
  ALL PASS, unaffected.
- `node specs/pipeline/cli.js specs/features/BL-1821-the-recruiter-scouts-a-batch-of-specifier-candidates.feature`:
  7 of 7 ok (the amended feature's new scenario included). Non-vacuous:
  removed the mark-before-pull write and re-ran - scenario 04 failed
  (second run re-batteried the same top 3 instead of the other 2);
  restored, re-ran, 7 of 7.
- Invariant re-checked: grep over `recruiter_specifier_scout.sh` still
  finds no `git` invocation and no write under `swarmforge/packs/` or to
  `swarmforge.conf` - the scout's writes are still exactly the score
  table, its report, its own `seen-specifier.jsonl`, and the battery's
  own evidence.
- No TypeScript references either changed file - no `npm test`/
  dependency-gate impact.

By coder.
