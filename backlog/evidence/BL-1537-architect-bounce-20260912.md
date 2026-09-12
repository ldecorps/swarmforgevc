# BL-1537 — architect review pass, 2026-09-12

Commit reviewed: 58ea9e9c7b (merge of cleaner 55a5037eff; coder work at e300226fae)

## Checks run

- Dependency gate (`node extension/out/tools/dependency-gate.js` against the
  four compiled changed TS files): PASSED, no forbidden edges.
- Co-change report against all changed files: no new suspected coupling
  introduced by this parcel (the hits returned are the closing-ceremony
  family's pre-existing hub coupling, itself unchanged by this diff).
- Declared invariant 1 (draft path depends only on root, never TMPDIR/
  os.tmpdir()): property test present, non-vacuous by inspection, green
  (`draftPathUnder.property.test.js`).
- Declared invariant 2 (draft removed on every exit path — queued, refused,
  signalled): property test present for `removeDraftIfPresent` and green,
  but see D1 below — one of the four shell senders this ticket touches does
  not actually satisfy this invariant for the "signalled" exit path.
- Shell fixture test `test_production_sender_drafts_under_root.sh`: 4/4 PASS.
- Full acceptance suite for the ticket's feature file: 9/9 scenarios PASS
  (all seven senders + the recorder scenario + the census scenario).
- Post-fix negative grep (`mktemp\)"$|mktemp "\$\{TMPDIR|os\.tmpdir\(\)`)
  scoped to exactly the seven sender files: one hit, `promote_and_route_next.sh:385`
  (`SED_TMP="$(mktemp)"`) — confirmed unrelated: a scratch file for an
  `assigned_to:` YAML rewrite, never touches `swarm_handoff.sh`, out of the
  invariant's scope (a "temp file for something else", per the ticket's own
  census language).
- Related unit tests (`closingCeremonyRun`, `closingCeremonyRunCli`, `tracer`,
  `nightClosingCeremonyRun`, `draftPathUnder`): 57/57 PASS, no regressions.
- `git status` clean after compile + full test run — no draft or build
  artifact became a tracked file.

## D1 — invariant 2 violated: `notify_specifier_freshness_hold` has no
signal-safe cleanup (class: `behavior`, blamed role: coder)

`swarmforge/scripts/promote_and_route_next.sh:277-302`
(`notify_specifier_freshness_hold`) creates its draft at line 281 and only
removes it with a plain `rm -f "$draft"` at line 301, after the send
attempt. There is no `trap ... EXIT` guarding this window, and no top-level
trap is active yet at the point this function runs — the script's only
`trap 'rm -rf "$PROMOTION_SNAPSHOT_DIR"' EXIT` is set at line 334, and
`notify_specifier_freshness_hold` is called earlier, at line 323. If the
script is signalled (SIGTERM/SIGINT) between the mktemp at line 281 and the
`rm -f` at line 301, the draft is left behind under `$ROOT/tmp/` — a
concrete violation of declared invariant 2 ("removed by that sender on
every exit path (queued, refused, signalled)").

This is the ONE inconsistent site among the four shell senders this parcel
touches: `route_backlog_to_coder.sh`, `mailbox_note_to_role.sh`, and
`inject_note_to_role.sh` each already wrap their draft in
`trap 'rm -f "$DRAFT"' EXIT` (kept, unchanged, per the ticket's own "How"
section), and this is the pattern the ticket text says should hold for
every shell sender. `notify_specifier_freshness_hold` never had this
protection even before BL-1537 (it drafted under `${TMPDIR:-/tmp}` and
leaked there on signal) — moving the draft under `$ROOT/tmp/` does not fix
that pre-existing gap, and this ticket is exactly the one that declares the
invariant the gap violates.

**Remediation**: add `trap 'rm -f "$draft"' EXIT` immediately after the
`mktemp` call in `notify_specifier_freshness_hold` (matching the other
three shell senders' pattern), and either drop the trailing `rm -f "$draft"`
or leave it (harmless with the trap in place, since a later `rm -f` on an
already-removed file is a no-op). Setting this local-scope trap does not
disturb the later top-level `trap ... EXIT` at line 334, because that trap
is set only after this function returns.

## Sweep for other sites of the same invariant

Checked all four shell senders + all three TS senders for the same gap:
only `notify_specifier_freshness_hold` lacks a `trap ... EXIT`
(`route_backlog_to_coder.sh`/`mailbox_note_to_role.sh`/
`inject_note_to_role.sh` already have one; the three TS senders use
`try/finally`, which is the pattern the ticket sanctions and is unchanged
systemic behavior across all three, not something this parcel need
redesign).

## Verdict

One correctness/invariant defect (D1). Sent back to coder. Everything else
in the checklist is clean.

By architect.
