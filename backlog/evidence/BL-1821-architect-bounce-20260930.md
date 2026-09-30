# BL-1821 — architect review pass, 2026-09-30

1 defect found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: reproduced directly (isolating both sides of the
  contract):
  ```
  python3 -c "
  import json
  found = [{'hf_id':'a/b'},{'hf_id':'c/d'}]
  BATCH = 1
  found = found[:1]
  if BATCH > 1:
      print(json.dumps({'candidates': found}))
  elif found:
      print(json.dumps({'candidate': found[0]}))
  "
  # -> {"candidate": {"hf_id": "a/b"}}
  python3 -c "
  import json
  d = {'candidate': {'hf_id':'a/b'}}
  print(json.dumps(d.get('candidates', [])[:1]))
  "
  # -> []
  ```
- **Commit hash**: b71a0a818c (the parcel received at architect)
- **First error excerpt**: `recruiter_hf_discover.py`'s `--batch N` branch
  is gated on `if BATCH > 1:` (line ~161), so `--batch 1` falls through to
  the SINGULAR `{"candidate": {...}}` shape instead of
  `{"candidates": [...]}`. `recruiter_specifier_scout.sh` always calls
  discovery with `--batch "$BATCH"` (never omitting the flag, even when
  `BATCH=1`) and parses the result by reading `d.get("candidates", [])`
  only (line 85) — which silently returns `[]` on the singular shape, even
  though a real candidate was found.
- **Failure class**: behavior
- **Expected vs observed**: the ticket's own approval_context: "the batch
  size N is operator-tunable (default 3)" — nothing restricts N to >= 2,
  and BATCH=1 is the smallest legal batch. Expected: a batch-N discovery
  with N=1 returns exactly one candidate to the scout, the same as any
  other N. Observed: with `--batch 1`, the scout parses zero candidates
  every time, regardless of how many real candidates exist — an operator
  who tunes the batch size down to 1 (the ticket's own stated tunable
  range) gets a scout that silently discovers nothing, every run, with no
  error or warning anywhere in the log. Not covered by either shell test
  (`test_recruiter_specifier_scout.sh`, `test_recruiter_nightly_specifier_scout.sh`)
  or the acceptance feature — all exercise the default batch (3) or
  higher.
- **Blamed role**: coder
- **Remediation pointer**: `recruiter_hf_discover.py`'s branch should be
  `if BATCH >= 1:` (or equivalently, the scout should pass no `--batch`
  flag at all when it wants the singular shape — but since the scout
  ALWAYS wants the batch shape regardless of N, the fix belongs in
  discover.py: emit `{"candidates": [...]}` whenever `--batch` was given
  on the command line at all, whatever its value, and reserve the
  singular `{"candidate": ...}` shape for the no-`--batch` invocation
  only, exactly as the docstring already promises ("The single-candidate
  shape above is UNCHANGED when --batch is absent"). Add a case for
  `--batch 1` to `test_recruiter_specifier_scout.sh` so this boundary
  cannot regress silently again.

By architect.
