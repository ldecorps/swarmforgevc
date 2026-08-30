# BL-1299 — architect review (clean pass)

Commit reviewed: 75cf3eb11d (Merge coder BL-1299-reverse-hop-targets-the-specifier-on-main into cleaner. By cleaner.)

## Checks run
- `node extension/out/tools/dependency-gate.js` — N/A: no `extension/src/**` files
  changed by this parcel (all changed files are `.bb`/`.js` pipeline steps and
  backlog/docs; confirmed via `git diff --name-only bfbbc4eeb0 HEAD`).
- `node extension/out/tools/co-change-report.js swarmforge/scripts/swarm_handoff.bb
  swarmforge/scripts/reverse_hop_lib.bb specs/pipeline/steps/index.js
  specs/pipeline/steps/bl1299ReverseHopMasterResidentSteps.js` — all reported
  co-changes are frequency 1-2, below the default threshold of 3. No suspected
  coupling.
- `bb swarmforge/scripts/test/bl1299_reverse_hop_property_runner.bb` — ALL PASS
  (500 runs), reach floors met for `any-master-resident`,
  `non-obvious-master-resident`, `deep-pipeline`, `non-empty-reverse`,
  `terminal-metamorphic`.
- `bb swarmforge/scripts/test/reverse_audit_handoff_test_runner.bb` — ALL PASS
  (22 cases), including both declared invariants and the roles-table-derivation
  scenario (BL-1299 scenario 04 equivalent).
- `bb swarmforge/scripts/test/suite_inventory_cli.bb` — ok, 443 test files,
  439 standing, 4 excluded with dated reason. `reverse_audit_handoff_test_runner.bb`
  is registered `standing`; the property runner correctly has no manifest row
  (property runners are their own lane, never a suite member — per the
  manifest's own header comment).
- `specs/pipeline/steps/index.js` registers `bl1299ReverseHopMasterResidentSteps`
  (required_wiring anchor confirmed by grep).

## Invariants review (Article, Invariants Review)
1. "No reverse git_handoff copy is ever addressed to a role whose worktree is
   the master checkout" — encoded as property `any-master-resident` +
   example tests; non-vacuous (generator makes arbitrary roles master-resident
   at random pipeline positions, not just the two known names).
2. "Changing the reverse-recipient set never changes which role is stamped
   terminal" — encoded as property `terminal-metamorphic` + example tests
   3/15/16.

## Architecture
- Fix correctly derives master-residency from `roles.tsv` (col 2), per the
  human ruling quoted in the ticket — no hardcoded second role name beside
  `coordinator`. `pack-role-names` was retired in favour of
  `reverse-hop-lib/pipeline-roles`, used consistently by both call sites
  (`last-pack-role?` and `reverse-roles`), so terminal-role stamping and
  reverse-recipient computation share one source of truth.
- `reverse_hop_lib.bb` is a new pure, testable module (extracted from
  `swarm_handoff.bb`), consistent with Design And Testability.
- Config bump `active_backlog_max_depth 1->2` in `full-forge.conf` and other
  unrelated-looking files (BL-472 note, BL-1305 approval, STEERING.md,
  intake archive) were verified via `git log bfbbc4eeb0..75cf3eb11d` to be
  inherited through "Merge main into coder" — not authored within this
  ticket's own commits (708420ab85, 833ee14f26). Not in scope for this
  bounce; not this parcel's defect.

## Verdict
Clean pass. Forwarding to hardender.
