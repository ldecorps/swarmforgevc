# BL-1782 — hardender review pass, 2026-09-30

1 defect found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: reproduced directly against a fresh mkdtemp
  fixture with `backlog/paused`, `backlog/active` and NO `.git` directory
  at all (deterministically forcing `commit_integrity_lib.bb`'s
  `:no-git-dir` refusal — no lock contention or race needed):
  ```
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/backlog/paused" "$WORK/backlog/active"
  bb swarmforge/scripts/verification_debt_ledger_update.bb "$WORK" \
    --record test-cat --ticket BL-1 --role QA --description "probe"
  ```
- **Commit hash**: a169ff8b5e (the parcel received at hardender)
- **First error excerpt**: exits 1 and prints "verification_debt_ledger_update:
  commit failed (:no-git-dir) - reverted, nothing recorded" — but
  `backlog/verification-debt-ledger.yaml` now EXISTS on disk, containing
  only the header comment block (7 lines, 447 bytes), where no such file
  existed before the call at all.
- **Failure class**: behavior
- **Expected vs observed**: the ticket's own What-is-wanted item 2 ("When
  the commit cannot be made, it leaves the file as it was and exits
  non-zero naming why") and the recorder's own docstring comment ("Refuses
  ... nothing written") both promise the file is left exactly as it was
  found. Expected: when no ledger file existed before the attempt, a
  failed commit leaves NO file on disk (as it was: absent). Observed: the
  revert path (`verification_debt_ledger_update.bb` lines ~113-118)
  unconditionally `spit`s `(render-ledger before)` where `before` is the
  rows read via `read-rows`, which returns `[]` for BOTH "file absent" and
  "file present but empty" (the distinction is lost the moment
  `read-rows` runs) - so on a fresh repo's FIRST-EVER record attempt, a
  commit failure leaves behind a brand-new, untracked, header-only ledger
  file where none existed a moment before. This is exactly the phantom-
  artifact class the shared Guardrails article's "no unrelated local/
  generated artifacts" concern exists for, one level narrower (a failed,
  refused operation is supposed to be a true no-op, not a partial one).
  Verified this is NOT the general case: when a ledger file already
  existed with real rows before a forced `:no-git-dir` failure on a
  SECOND record, the revert correctly restores the exact original
  content byte-for-byte (confirmed via direct diff) - the defect is
  narrow, specific to the very first record against a fresh repository,
  which is also exactly the shape of this ticket's own seed (four rows,
  each its own commit, starting from an absent file) and of every real
  operator's very first use of the recorder on a project.
  Not covered by either the lib test runner or the acceptance feature:
  every acceptance scenario's fixture (`mkFixtureRepo()`) is a real,
  fully-initialized git repository, so `commit-with-integrity!` never
  fails there and this revert branch is never exercised by any existing
  test.
- **Blamed role**: coder
- **Remediation pointer**: `verification_debt_ledger_update.bb`'s
  `-main` needs to distinguish "the ledger file did not exist before this
  attempt" from "the ledger file existed with zero rows" — capture
  `(fs/exists? (ledger-path project-root))` (and, if it existed, its raw
  text) BEFORE the write, and on a commit failure either restore that raw
  text (file existed) or delete the file entirely (file did not exist),
  rather than always re-rendering `before`'s (possibly empty) row vector.
  Add a scenario or case exercising this exact revert path — a fixture
  root with no `.git` at all is the deterministic, race-free way to force
  the failure (no lock contention or timing needed), matching the probe
  above. `test_install_starter_kit.sh`-style byte-identical-hash
  comparison (already the pattern this constitution's Guardrails favor
  for "leaves everything untouched" claims) is the natural assertion
  shape once the fix lands.

By hardender.
