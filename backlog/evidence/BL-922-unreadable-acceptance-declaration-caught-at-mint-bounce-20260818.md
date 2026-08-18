# BL-922-unreadable-acceptance-declaration-caught-at-mint — architect bounce

Architect ran the full gate inventory (Article 4.4 — complete pass, one
bounce). Every gate below was RUN, not assumed. Only D1 is a real defect;
everything else is recorded PASS/N-A for the record.

## D1 — correctness/hygiene: new acceptance step handler leaks its fixture
temp dir on EVERY scenario run, pass or fail — not only on failure

1. **File**: `specs/pipeline/steps/bl922UnreadableAcceptanceCaughtAtMintSteps.js`
2. **Commit reviewed**: `997015b48b` (coder's commit, forwarded unchanged by
   cleaner).
3. **What's wrong**: `ensureState(ctx)` (lines 30-35) creates a fixture root
   via `fs.mkdtempSync(path.join(os.tmpdir(), 'bl922-hygiene-'))` on first
   use per scenario. Across the file's 4 scenarios (10 scenario-outline
   rows total: 5+3+1+1), only ONE cleanup call exists anywhere —
   `fs.rmSync(st.tmpDir, ...)` at line 179, inside the LAST step of scenario
   04 only, reached only after that step's own assertion at line 176
   passes. Concretely:
   - Scenarios 01 (5 rows), 02 (3 rows), and 03 (1 row) — 9 of the 10
     scenario runs — never call `rmSync` on their fixture root AT ALL, not
     even on the happy path. Every single passing run of this feature file
     leaks 9 directories.
   - Scenario 04's own tmpDir (created by the same `ensureState` even though
     scenario 04 never writes a ticket into it — it only runs the
     repo-wide audit against the real repo) is cleaned up, but only if its
     assertion at line 176 doesn't throw — the one case where preserving
     the fixture for debugging would matter most skips cleanup too.
4. **Verified empirically, not just by reading the code**: ran the feature
   via `node specs/pipeline/cli.js
   specs/features/BL-922-unreadable-acceptance-declaration-caught-at-mint.feature`
   (10/10 scenarios passed) and then checked the real OS temp
   dir:
   ```
   find "$(node -e 'console.log(require("os").tmpdir())')" -maxdepth 1 -iname 'bl922*'
   ```
   45 leftover `bl922-hygiene-*` directories found (accumulated across this
   and prior runs on this host — the coder's own dev/test cycles while
   building the ticket already demonstrate the leak rate: it is not a
   theoretical failure-path-only concern, it happens on every green run).
5. **Failure class**: `behavior` (resource-leak / test-hygiene defect I can
   see directly).
6. **Why this is a real defect here and not a nitpick, and why it recurs**:
   this is the SAME defect class I bounced minutes earlier on this parcel's
   immediate predecessor,
   `BL-921-chase-trusts-active-role-marker-over-pane-identity` (same coder,
   same session — see `backlog/evidence/BL-921-chase-trusts-active-role-marker-over-pane-identity-bounce-20260818.md`),
   which itself mirrors a same-day precedent fix in this exact repo
   (`be5ccb372 Cleanup BL-913: guarantee temp-dir cleanup on failure in
   tool-miss-heal test runners`) and an established convention already in
   this step-handler family (`bl870WakeAttributionSteps.js`'s `cleanup(ctx)`
   helper, invoked from try/finally at every assertion step). BL-922's leak
   is the more severe of the two recurrences — BL-921 only leaked on
   failure; this one leaks on every run, pass or fail.
7. **Remediation pointer**: wrap fixture creation/use in try/finally (or
   track every `st.tmpDir`/per-scenario-root allocation and sweep it from a
   single `cleanup(ctx)` called at the end of every Then-step, matching
   `bl870WakeAttributionSteps.js`'s pattern) so scenarios 01-03 clean up
   their fixture roots too, and scenario 04's cleanup runs whether or not
   its assertion passes.

   Owning role: **coder** (author of both this file and
   `bl921ChaseVerifiesLiveIdentitySteps.js`, `997015b48b` /
   `c29a61dc92951c`).

## Everything else run — complete inventory, none blocked

- **Ticket invariants** (3 declared): invariant 3 ("a ticket whose
  acceptance body names no feature file is never reported... at any call
  site") has a non-vacuous property test — P1 plus a P1-sanity companion
  that injects a real feature path into the SAME generator shape to prove
  P1 isn't vacuously true. Independently re-run:
  `bb swarmforge/scripts/test/backlog_hygiene_lib_property_runner.bb` →
  `300 runs each / ALL PROPERTIES HOLD`, indicator-coverage floor satisfied
  for all 5 block-scalar indicators. Invariants 1 and 2 are stated as
  architectural/satisfied-by-construction rather than property-tested — I
  did not just trust that claim: read `unreadable-acceptance-violation` and
  its call chain directly and confirmed (a) it consults
  `acceptance-pointer-gate-lib/block-scalar-residue?` rather than
  restating the pattern (single definition site, grepped), and (b) no
  file-write/`spit`/IO call exists anywhere on this new code path — both
  claims hold.
- **Unit runner**: `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`
  → `backlog_hygiene_lib_test: all passed`, covering all 5 block-scalar
  indicators, the single-line-pointer/no-feature-file/absent negative
  cases, and the BL-555/BL-588 glob-shaped-mention regression by name.
- **Acceptance**: `node specs/pipeline/cli.js
  specs/features/BL-922-unreadable-acceptance-declaration-caught-at-mint.feature`
  → 10/10 scenario rows PASS, including scenario 04's real
  `backlog_epic_milestone_audit.bb` run against the live repo (the ticket's
  own standing-guard acceptance).
- **Repo-wide audit re-run directly**: `bb
  swarmforge/scripts/backlog_epic_milestone_audit.bb` → `unreadable
  acceptance (block scalar hiding a feature pointer): 0`, `backlog_epic_milestone_audit: ok`
  (181 open tickets scanned) — confirms the 11 YAML repairs are actually
  complete and correctly shaped, not just claimed.
- **required_wiring** (2 items): both confirmed present — (1)
  `acceptance_pointer_gate_lib.bb` gained a new public
  `block-scalar-residue?` wrapping the existing private pattern, and
  `backlog_hygiene_lib.bb`'s new check calls it rather than restating the
  regex; (2) `backlog_epic_milestone_audit.bb` now filters, counts, and
  prints the new `:unreadable-acceptance` kind by name (previously any new
  violation kind would silently fail `all-clean?` while printing nothing —
  the exact BL-897-adjacent drift-and-silence shape the ticket names).
- **Spot-checked 2 of 11 YAML repairs by hand** (BL-609, the simplest;
  BL-626, the largest/most complex diff at 77 lines): both correctly
  reduce `acceptance:` to a bare single-line pointer and relocate the
  displaced prose verbatim — the QA-procedure text to `qa_e2e_procedure:`,
  everything else to `notes:` (BL-626 appending under a new heading to an
  existing `notes:` block rather than overwriting it) — nothing dropped,
  matching Article 5.3's spirit even though this predates that article's
  own scope. Confirmed the two deliberately-dangling cases (BL-579, BL-580)
  now carry a single-line pointer at a path that does not yet exist on
  disk, which is the intended early, honest failure at the BL-880 gate,
  not a regression introduced by this repair. Confirmed BL-533/BL-534
  (inline Gherkin, explicitly out of scope) are untouched by this commit.
- **Dependency-gate hard gate** (BL-259): N/A this parcel — every changed
  file is under `swarmforge/scripts/`, `specs/pipeline/steps/`, or
  `backlog/paused/`, none under `extension/src` or `extension/media`, the
  only scope `dependency-gate.js` resolves against.
- **Co-change report**: run against all 7 non-YAML changed files.
  `specs/pipeline/steps/index.js` surfaces heavy "SUSPECTED COUPLING" —
  expected hub-file noise (it registers every step-handler module in the
  repo, so it co-changes with nearly everything); nothing points at a
  boundary this ticket's own scope should have addressed. The 11 repaired
  YAML files each show exactly 1 co-change (with the new step-handler file
  itself, from this same commit) — not a signal.
- **Architecture boundary rules**: N/A — zero files under `extension/`
  touched; this parcel is entirely `swarmforge/scripts/*.bb` (the
  maintained fork itself), `specs/pipeline/steps/*.js` (test
  infrastructure), and `backlog/` YAML.

By architect.
