# BL-1341 — architect pass, 2026-09-02

Reviewed cleaner commit `479373f6a9` (two trivial fixes), forwarding coder's
`c90be7587e..963dec3774` (second-direction fix per the ticket's own
directive).

This ticket fixes exactly the class of guard false-positive I hit twice
today (BL-1343, BL-1340 merges) — read it with direct interest.

## The fix, verified against the ticket's directive
- `swarmforge/scripts/check_merge_deletion.sh`: `collect_deletions` now
  called against BOTH `HEAD` and `MERGE_HEAD`, into one `deleted_paths`
  list with a `side_of` map — confirmed by reading the script. A path
  dropped from both sides is recorded once (dedup confirmed by test 13 and
  the property test's "reported once" assertion). Attribution
  (`ticket_id_for_path`/`introducing_commit_for_path`) falls back to
  `MERGE_HEAD` when `HEAD` knows nothing about the path — the subtlety the
  coder found beyond the ticket's own text (an incoming-only path asked
  only of `HEAD` would report `(unattributed)` and become unexemptable).
- Single script, single refusal/exemption model — confirmed no new sibling
  script created, matching the ticket's explicit "do NOT split this into a
  second script."
- `is_ticket_yaml_path` exclusion (BL-901's domain) preserved unchanged —
  no double-reporting with `check_ticket_deletion.sh` (test 06, 09).

## Checks run (not assumed)
- `bash swarmforge/scripts/test/test_merge_deletion_guard.sh` — **13/13
  PASS**, including test 07 (a REAL `git merge --no-ff` through the
  installed `commit-msg` hook, refused) and tests 10-13 (the new
  incoming-side cases: unaccounted drop refused naming path/ticket/side,
  named drop allowed, keep-everything allowed, both-sides dedup).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1242-merge-never-silently-drops-branch-work.feature` —
  **12/12** (was 7). Scenario 03 correctly re-tensed ("removes nothing
  either branch carries," not the old receiving-only claim) — confirmed by
  reading the file.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- **Property test flakiness check** (given today's BL-1343 precedent):
  initially misread `caseArb`'s unused `side` field as driving the branch
  and estimated a ~26% miss risk from a naive 3-way categorical read;
  re-reading the code shows the actual branch is the `for (const side of
  [...])` LOOP variable, not `c.side` — each of the three shapes
  (receiving/incoming/both) gets its OWN deterministic `fc.assert` pass, so
  reach is guaranteed by construction, not chance (same fix pattern the
  coder applied to BL-1343 earlier today). Ran the file **12 times**
  consecutively — 12/12 clean, consistent with deterministic reach. Cleaner
  independently reached the same conclusion (3x clean) and explicitly names
  avoiding the BL-1343 flakiness class as a design goal.
- Live-history reproduction (qa_e2e step 1), reproduced myself:
  `git diff --name-status 0132715d1e b71c941a19` → 0 deletions;
  `git diff --name-status 0a5bffe057 b71c941a19` → 9. Confirms this fix's
  second comparison is exactly what would have refused the incident merge.

## Left undone, correctly scoped
BL-1242's mutation-manifest stamp (this feature never had one before this
change) is left unstamped — correctly out of coder/cleaner scope
(Guardrails forbids hand-editing a manifest); flagged for the hardener, who
is in `required_stages`. Same disposition I already confirmed correct on
BL-1340 earlier today.

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
