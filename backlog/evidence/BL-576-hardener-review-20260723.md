# BL-576 — hardener review (2026-07-23)

Reviewed commit: `b3429f9aaa` (architect PASS, forwarded for hardening).
Verdict: **hardened — forwarding to documenter.**

## Architect finding F1 (the significant one) — closed

The architect flagged that `bl576AgedNoteActionabilitySteps.js` hand-builds
mono-router-lib score rows in JS for scenario 03, bypassing
`handoffd.bb/role-mail-row` entirely — the one place the ordering-key
regression could occur: dropping `aged-notes` from
`(concat held git-hfs aged-notes)` would make a note-only mailbox's
`:newest-created-at` empty, so it would silently lose every rotate-preference
comparison, while every existing unit and acceptance assertion stayed green.

Added `swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh` — a
real (fake-tmux) `handoffd.bb` daemon wiring test, not a unit test against
the pure lib in isolation:

- **Scenario A**: a dormant `specifier` mailbox holds only an aged note
  (enqueued 25 minutes ago); a dormant `cleaner` mailbox holds an OLDER
  (40-minutes-ago) `git_handoff`. Asserts the daemon's own chase sweep logs
  `chase-rotate specifier` (never `chase-rotate cleaner`), that
  `rotate-resident-to!` actually fires a real `tmux respawn-pane` against the
  fake tmux, and that `.swarmforge/mono-router-active-role` ends up reading
  `specifier`. This is the ordering-key case: the note is NEWER than the
  rival git_handoff, so it must win only if aged notes feed
  `:newest-created-at`.
- **Scenario B**: the same dormant `specifier` mailbox holds one FRESH note
  (2 minutes old). Asserts the daemon logs
  `chase-rotate-skip-broadcast specifier` and never rotates — the
  broadcast-thrash guard this ticket must not weaken.

**Regression check performed and reverted**: temporarily changed
`(concat held git-hfs aged-notes)` to `(concat held git-hfs)` in
`handoffd.bb`'s `role-mail-row` and re-ran the new test — Scenario A now
fails exactly as F1 predicts (`chase-rotate-skip-not-preferred specifier
cleaner` — cleaner wins wrongly). Reverted via `git diff` confirming a clean
no-op restore, then re-ran green. The test is load-bearing.

## Architect finding F2 — boundary mutant — closed

Added two assertions to `mono_router_lib_test_runner.bb`: `note-aged?` at
exactly `threshold-ms` (must be aged, pins the `>=`) and at one second short
of it (must not be aged). Kills the `>=` → `>` survivor F2 named.

## BL-113 soft Gherkin mutation — run for the first time on this feature

No manifest existed yet (the architect's evidence table recorded a plain
acceptance PASS, not a mutation run). Ran
`run_gherkin_mutation.sh specs/features/BL-576-aged-note-actionability.feature`
at `soft` level. Result: 30 mutations across the outline scenarios that have
`Examples:` tables (scenarios 05/06 are plain `Scenario:` with no example
values — nothing to mutate, per this role's own skip rule), 21 killed, 9
survived, embedded manifest now covers scenarios 0, 2, and 6 (clean).
Scenarios 1 and 3 are absent from the manifest because BL-502: a scenario is
recorded only when `Survived=0 AND Errors=0` — both had survivors.

**All 9 survivors are equivalent mutants, verified against the code, not
forced-killed with artificial assertions (BL-234):**

- **Scenario 02** ("the age clock is the parcel header…"), all 5 examples'
  `mtime` mutants survived. This is the scenario's own point: `note-aged?`
  takes no mtime parameter at all (`mono_router_lib.bb`), and the step
  handler comments that `mtimePhrase` is parsed and then deliberately
  ignored. Any mutation to an argument the code never reads is equivalent by
  construction.
- **Scenario 04** ("the threshold is read from the effective config…"), 4
  survivors on the `conf_line` examples whose EXPECTED outcome is already
  "20 minutes" (default) regardless of the exact malformation: empty→"x",
  `abc`→`abC`, `0`→a config-key-name typo, `-1`→a config-key-name typo.
  Traced `parse-note-actionable-after-ms`: an empty/non-matching line and a
  line that matches the key but carries an invalid value (`0`, `-1`, no
  digits) both fall through to the same default, so a mutation that flips
  between "doesn't match the key at all" and "matches the key but is still
  invalid" cannot change the outcome for these four rows. Example row 0
  (`600000` → 10 minutes) is NOT among the survivors — a key-name mutation
  there DOES change the expected outcome, so the "the config key must match
  exactly" behavior is in fact covered; it is only the already-invalid rows
  that are equivalent.

No feature/step-handler changes were made for these — forcing an assertion
that could only ever pass would test implementation trivia, not behavior.

## F3 (vacuous step handlers, scenario 05) — no action

Scenario 05 is a plain `Scenario:` (no `Examples:` table), so per this
role's own duty ("a plain Scenario has no example values to mutate — skip
it") it is out of scope for Gherkin mutation entirely; the concern the
architect raised does not apply to it the way it would to an Outline. The
two vacuous steps' own comments correctly point at pre-existing, separately
tested mechanisms (BL-550 rotate-home, the note-drain path) that this ticket
does not touch. No change made.

## F4/F5 — not this role's

F4 (docstring + runbook) is the documenter's; F5 (accepted duplication) is
recorded by the architect as no-action-wanted. Both carried forward as-is.

## Verification

- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — ok.
- `bash swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh` — ALL PASS.
- `bash swarmforge/scripts/test/test_handoffd_chase_sweep_wiring.sh` — ALL PASS (no regression).
- No mutation/CRAP/DRY run: this parcel touches only `.bb` swarm scripts,
  which per engineering.prompt's tool table have no wired mutation/CRAP/DRY
  tooling — the `swarmforge/scripts/test/` suite above is the real gate.
- No orphaned test/daemon processes left running (checked via `ps`/`pgrep`
  after every run; the new wiring test's own fake daemons are killed via its
  `trap cleanup EXIT` handlers).

By hardener.
