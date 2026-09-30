# BL-1821 — coder bounce fix, 2026-09-30 (QA bounce, second pass, evidence 698a268a8b)

## What changed

- `swarmforge/scripts/recruiter_hf_discover.py` (D1): the batch-discovery
  loop now tracks the aliases it has already picked in THIS run
  (`batch_aliases`) and skips a later candidate whose `alias_for()`
  collides with one already selected, counting it under
  `rejected["duplicate-alias"]` and continuing to scan for the next
  distinct-alias candidate. Previously only a collision with an
  already-REGISTERED `local/<alias>` (`registered`, read from disk) was
  checked - two different repos normalizing to the same alias within one
  batch both rode along, and a real run's `ollama cp` silently
  overwrote the first's alias with the second's weights, collapsing two
  distinct models into one score-table row.
- `swarmforge/scripts/test/test_recruiter_hf_discover_batch.sh`: case 04,
  per QA's own remediation pointer - two different trusted orgs
  publishing a same-named repo (`Llama-3.2-3B-Instruct-GGUF`), plus a
  third distinct repo; `--batch 2` returns the first and third (distinct
  aliases), never the colliding second, with `rejected.duplicate-alias`
  counting it.

D2 (the seen.jsonl spec gap) is not part of this parcel - QA's own
evidence routes it to the specifier by note, blamed specifier, not
coder.

## Verification

- `bash swarmforge/scripts/test/test_recruiter_hf_discover_batch.sh`:
  ALL PASS (7 checks, including the 3 new case-04 ones). Non-vacuous:
  reverted the fix and re-ran - 2 of the 3 new checks failed (aliases
  collapsed to the duplicate, `duplicate-alias` read 0); restored,
  re-ran, ALL PASS.
- `bash swarmforge/scripts/test/test_recruiter_specifier_scout.sh`:
  ALL PASS (13 checks, unaffected - this fix is upstream of the scout,
  which only ever sees already-deduplicated candidates).
- `bash swarmforge/scripts/test/test_recruiter_nightly_specifier_scout.sh`:
  ALL PASS, unaffected.
- `node specs/pipeline/cli.js specs/features/BL-1821-the-recruiter-scouts-a-batch-of-specifier-candidates.feature`:
  6 of 6 ok, unaffected (no scenario touches the discovery step's own
  duplicate-alias handling - covered at the shell-test level per QA's
  own remediation pointer).
- `python3 -c "import ast; ast.parse(...)"`: syntax OK.
- No TypeScript references `recruiter_hf_discover.py` (grep, no hits) -
  no `npm test`/dependency-gate impact.

By coder.
