# BL-1842 — architect review pass, 2026-09-30

1 defect(s) found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: `find extension/test -iname '*1842*'` (no output);
  `git diff main HEAD --stat | grep -i 1842` (no `.property.test.js` among
  the new files) — no property test exists anywhere in this parcel for
  the ticket's one declared invariant.
- **Commit hash**: 683bbecb45 (cleaner tip received; reviewed as merged at
  19ca206f41)
- **First error excerpt**: coder evidence (`backlog/evidence/BL-1842-coder-20260930.md`,
  "Invariants (BL-654)") states "No executable property encoding... this
  is a code-shape claim (absence of a category of call), not a
  generator-reachable state a property test can falsify".
- **Failure class**: invariant-unencoded
- **Expected vs observed**: the declared invariant — "The local-seat
  report is read-only: running it changes no file, pane or process." —
  is NOT a code-shape claim about `local_seat_report_lib.bb`/
  `local_seat_report_cli.bb`'s own implementation (unlike BL-1846's
  invariant 1, which turned on a delegation pattern no black-box run
  could observe without stubbing a subprocess). It is a plain black-box
  input/output property over the real CLI: build an mkdtemp fixture root
  with generator-drawn usage/session/log content and CLI args
  (`--seat`, `--sessions`, `--now-ms`), snapshot the fixture tree
  (recursive file list + content hash + mtime) before invoking the real
  `local_seat_report_cli.bb` via `execFileSync`, snapshot again after, and
  assert the two snapshots are identical. This needs no stubbing and no
  claim about internal shape — it drives the actual shipped binary over
  generator-drawn inputs exactly as BL-1846's invariant 2 property test
  drives `coordinator_config_lib.bb`'s `deterministic-coordinator?` over
  generator-drawn conf text. The coder's own "no side-effecting call
  anywhere... grep confirms no spit/fs/create-dirs/fs/delete/kill"
  argument is itself evidence FOR encodability (a directory-snapshot
  property would simply confirm this mechanically, across every input
  shape a hand grep cannot enumerate, such as a `--seat` value crafted to
  collide with an unexpected path) rather than a reason to skip it.
- **Blamed role**: coder
- **Remediation pointer**: add `extension/test/bl1842LocalSeatReportReadOnlyInvariant.property.test.js`
  (or beside the existing `bl18xx*` property tests): a fast-check property
  building a random fixture root (qwen usage dir, session chat file,
  ollama log, all with generator-drawn but well-formed content) and
  generator-drawn CLI args, snapshotting the root's full file tree
  (path + content hash + mtime, recursively) before and after running the
  real `local_seat_report_cli.bb` via `execFileSync`, asserting the two
  snapshots are byte-identical. Non-vacuous: add a throwaway `(spit ...)`
  call to the CLI or lib, confirm the property fails, then remove it and
  confirm it passes again (the same break-then-fix discipline every other
  property test in this codebase already follows).

## Note

`record-bounce.js` was invoked with `--class behavior` by mistake; the
correct class per the Invariants Review recording rule is
`invariant-unencoded` (a missing/vacuous property test for a declared
invariant, distinct from a violated one). The structured bounce record at
`backlog/active/BL-1842-a-local-model-seats-health-is-one-command-away.yaml`
therefore reads `class: behavior` for this D1; this evidence file is the
correct record of the actual class. Attribution (blamed: coder) is
correct, so `record-bounce-correction.js` (built for misattribution, not
class) was not used.

By architect.
