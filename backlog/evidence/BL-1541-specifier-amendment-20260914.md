# BL-1541 - specifier amendment, 2026-09-14

Answers three coder notes of 2026-09-14 on the unforwarded BL-1541 parcel
(`317ca4f402` on `swarmforge-coder`; cleaner mailbox empty, coder mailbox
empty, resident rotated to specifier):

1. `00 02:32` "bl982 Invariant-2 byte-identity red is stale pre-blob, separate from BL-1541"
2. `00 03:09` "unowned-red bl982 invariant-2 stale pre-blob pin, not BL-1541's cause"
3. `50 03:38` "acceptance BL-1358 300s ceiling too short post-BL-1541 doubled sends"

## Finding 1 - bl982 invariant 2 (folded in, no mint)

- `bl982_multi_seat_identity_property_runner.bb` invariant 2 compares the
  single-seat `roles.tsv` written by the current `swarmforge.sh` against the
  one written by blob `2edd9a17ba9d40709c0f436d12395b638563c0ca` (the pre-BL-982
  script), normalized on the fixture root, whole-line bytes.
- Pre-blob `write_roles_file` prints 8 columns (`printf` at its line 810).
  HEAD prints 9 (`swarmforge/scripts/swarmforge.sh:1156`, column 9 =
  `${PROPAGATION_MODES[$i]:-forward-only}`). `git log -S` on the 9-field
  format string names `44d2d42591` (2026-08-30, "Steal upstream reverse
  git_handoff hops and two-call AUDIT_REQUIRED") - the same landing that
  broke invariant 3, so first_seen is the same day and the row already
  carried the right date.
- Coder reproduced it unchanged at HEAD before its fix and after
  (commit body of `317ca4f402`): bl982 fails ONLY on invariant 2 now.
- Owner decision: BL-1541. The register is keyed per test FILE and its
  bl982 row names BL-1541; the ticket's title and e2e step 2 already
  require bl982 to exit 0; a sibling owner touching the same file could
  not be promoted beside the active ticket (Concurrent Work
  Orthogonality). The ticket's constraint "every existing property keeps
  its meaning" is what stopped the coder - correctly - so the amendment
  carves out exactly that one oracle, with direction: projection onto the
  pre-blob's column set, never a re-pin (re-pinning re-rots at the next
  appended column, which is how roles.tsv evolves by design).

## Finding 2 - the acceptance could not fit the BL-1358 ceiling (spec defect, mine)

- Scenario 01 ran all five real runners per mutant. bl982's header measures
  ~2.4 s/draw x 100 draws = ~240 s alone, before the doubled sends; bl992
  draws 100; bl991 40; bl983 16; bl951 12. The generated test for the
  feature is one `node --test` child per mutant with `timeout: 300000`
  and a timed-out mutant fails the gate (human ruling 2026-09-03, option
  1). No per-feature override exists (`resolveMutantTimeoutMs`: explicit
  opt or `GHERKIN_MUTATION_TIMEOUT_MS`, both global).
- The coder's manual run needed `GHERKIN_MUTATION_TIMEOUT_MS=1800000` to
  finish at all. Raising the ruled default is not BL-1541's to do; a
  standing runner that takes minutes is proven by running it (QA e2e,
  register discharge), not by a scenario that re-runs it per mutant.
- Amendment: scenario 01 retired (never reworded); scenario 03 (two rows: queued, refused)
  gates the shared helper's contract in seconds; scenario 02 unchanged.
  `specifier.prompt` gains the rule so the arithmetic is done at mint.

## Not done

- No new ticket. No register row added (per-file key; row note amended
  to name both halves). `human_approval` left `approved` - see the
  ticket's notes for why re-pend is the wrong tool (BL-1455).
- The bl982 runner was not re-run here: the coder's reproduction and the
  printf diff are the evidence; the runner's invariant-3 half is not on
  `main` yet, so a run here would fail on that first.
