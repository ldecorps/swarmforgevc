# BL-1360 — architect review, pass (2026-09-03)

## Scope reviewed

Cleaner's tip (`0a204b13ae`), merged into this worktree at
`Merge cleaner 0a204b13ae for BL-1360. By architect.`. `swarmforge/` is
Babashka/Clojure — per Startup Tools, no mutation/CRAP/DRY wired for it
(BL-472 deferred); gated by its own unit-test suite plus the JS-side
mutation-site-count advisory on the two touched `.js` files, both already run
by the cleaner.

## Dependency gate (BL-259, hard gate — JS/TS side only)

    cd extension && node out/tools/dependency-gate.js \
      ../specs/pipeline/steps/bl1360CeremonyHandoffComposedSteps.js

`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change (BL-255, informational)

`bl1360CeremonyHandoffComposedSteps.js`'s co-changes are entirely in-scope
(its own lib/CLI/tests, `index.js` registration, evidence). `index.js`
itself carries pre-existing SUSPECTED COUPLING against dozens of files — it
is the shared step registry, expected, not new coupling this ticket
introduced.

## Architecture read

- `ceremony_handoff_lib.bb` is pure: composes a draft string, never touches
  the filesystem or a process. `ceremony_handoff.bb`/`.sh` is the only
  impure layer, and it is a genuine thin front end over the REAL
  `swarm_handoff.sh` — verified by reading the source: on a successful
  compose it writes the draft to worktree-local `tmp/ceremony-handoff.txt`
  (never `/tmp`) and shells out to `swarm_handoff.sh`; on any parse/compose
  error it exits before touching the filesystem at all. No second path into
  a mailbox exists.
- `--dry-run` prints the draft and exits before the shell-out — confirmed in
  source and by property P1 (fixture-backed: asserts a dry run delivers to
  no mailbox across 12 runs).
- A send-time gate's refusal passes through unchanged: coder's evidence
  documents a real bug here (stderr flushed outside its own `binding`, so a
  gate refusal was swallowed — exit 2, empty stderr) found by the acceptance
  driver and fixed; each stream now flushes inside its own binding. Read the
  fix in `ceremony_handoff.bb` — correct.
- Recipient/priority/message-shape have exactly one definition
  (`ceremony_handoff_lib.bb`'s `ceremonies` map); property P3 parses
  `handoff-protocol.md` itself rather than restating the claim (BL-897) —
  read the parser, it does look for the literal documented merge-up/bookkeep
  steps and cap, not a hardcoded mirror.
- Message composition never truncates the ticket id or commit: shortening
  happens only across pre-written prose forms, and composing fails outright
  rather than cut either fact (read `compose-message`/`compose`).

## Invariants (BL-633/654) — all three declared, all three covered

1. Every ceremony sent through `swarm_handoff.sh` — P1, fixture-backed
   (12 runs default, real git+mailbox fixture, tool-stamped-header check).
   NON-VACUOUS per coder evidence (direct-inbox-write break → 60 FAIL P1).
2. One-line, cap-respecting, never truncates ticket/commit — P2, 500 pure
   runs across generated ticket/commit lengths, asserts all three outcomes
   (roomy/shortened/refused) are actually observed rather than sampled into
   only the easy case. NON-VACUOUS (subs-truncation break → 148 FAIL P2).
3. One definition, pinned to `handoff-protocol.md` by parsing it — P3.
   NON-VACUOUS (dropping `hardender` from the lib's list → FAIL P3).

Ran the property runner directly: `bl1360 ceremony handoff: ALL PROPERTIES
HOLD (500 pure runs)` — the summary line doesn't restate the 12 fixture-backed
runs in its count, but reading the source (line 256-299) confirms that block
executes unconditionally before the summary and reports into the same
`failures` atom; not a gap, just a shorter status line than the cleaner's
prose implied.

## Verification run directly

- `bb swarmforge/scripts/test/ceremony_handoff_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_ceremony_handoff_cli.sh` — 6/6 checks.
- `bb swarmforge/scripts/test/bl1360_ceremony_handoff_property_runner.bb` —
  ALL PROPERTIES HOLD.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1360-*.feature` — 6/6.
- `specs/pipeline/steps/index.js` — `bl1360CeremonyHandoffComposedSteps`
  registered (required_wiring satisfied).

## Property-testing pass (own section, BL-654 scope boundary)

The three declared invariants are the ticket's own obligation, authored by
the coder and reviewed above. No other touched pure module needs new
property coverage — `parse-args`/`compose`/`compose-message` are exactly
what P1-P3 already exercise; `ceremony_handoff.bb`'s shell-out layer is the
untestable-without-a-process boundary and is covered instead by the CLI
end-to-end test (V2/C2), which is the correct lane for it.

## Correctness read

No defect spotted. The stderr-flush bug the coder found and fixed is exactly
the kind of correctness defect this role would otherwise send back — already
closed before this parcel reached me, verified by reading the fix and by
`test_ceremony_handoff_cli.sh`'s scenario 3 passing.

## Verdict

No defect found. Forwarding to hardener.
