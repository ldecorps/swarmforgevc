# BL-944 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 38f6e49b37`. The actual
implementation is coder's `3da6225bd` ("BL-944: fixture dependency list now
derives its closure check from source"); a second coder commit `7d9c1179d6`
adds only the surfaced-defect evidence file. Cleaner forwarded unchanged.

Files reviewed (`git show --stat 3da6225bd` + `7d9c1179d6`):
- `specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` (the
  hand-maintained fixture list: +7 entries, -1 (`operator_ask.bb`), new
  `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS` export)
- `specs/pipeline/steps/lib/operatorRuntimeBbClosure.js` (new — derives the
  real transitive load-file closure from source)
- `extension/test/operatorRuntimeBbFixtureClosure.test.js` (new — the
  standing closure-honesty guard)
- `specs/pipeline/steps/bl944OperatorRuntimeBbFixtureDependencyClosureSteps.js`
  (new — this ticket's own acceptance step handler)
- `specs/pipeline/steps/index.js` (+1 registry line)
- `backlog/evidence/BL-944-surfaced-defect-not-fixed-20260819.md` (new —
  D1, a genuine, separate, out-of-scope defect surfaced by this fix)

Confirmed nothing under `swarmforge/scripts/` is touched (ticket's own hard
constraint) — `git show --stat` on both commits names only the six files
above, matching qa_e2e_procedure step 7.

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate (BL-259 hard gate)** — ran per-parcel against all
   5 JS/TS files in the diff. `specs/pipeline/steps/index.js` alone (and in
   combination with the others) reports a 3-edge `acyclic` violation in
   `telegram-front-desk-bot.ts`/`telegramCursorOperatorExec.ts`/
   `telegramCursorOperatorLiveness.ts` — none of which BL-944 touches.
   Confirmed pre-existing and unrelated three ways: (a) it also fires in
   full-repo mode with zero args, (b) it fires identically against the
   pre-BL-944 version of `index.js` (`git show bc03a248f:...index.js`,
   differing from HEAD by only the one new require line), (c) it is
   already tracked at `backlog/paused/BL-759-cursor-operator-front-desk-
   bot-import-cycle.yaml` and was already ruled non-blocking by two prior
   architect passes this session (BL-937, BL-938) for the identical
   structural reason — `index.js`'s own DOMAINS array pulls in the whole
   step-handler graph regardless of what any one ticket adds. Not this
   parcel's defect, not blocking.
2. **Co-change report (BL-255)** — ran against the 4 non-registry changed
   files. `operatorRuntimeBbFixtureFiles.js` shows several frequency-3/5
   "SUSPECTED COUPLING" hits (telegram-bridge files, ambulance/handoff
   files, their step handlers and test runners) — this is the exact,
   already-diagnosed pattern the ticket itself exists to fix: the list has
   needed hand-patching every time one of those files gained a new
   load-file dependency (BL-412/413/458/647/655). The ticket's own
   `constraints` explicitly rule out replacing the copy-a-named-list
   mechanism this parcel — "This slice keeps the mechanism and makes the
   list honest" — so continued co-change with those files is expected
   under the accepted design, not a defect this parcel introduces or fails
   to address. The three new files (`operatorRuntimeBbClosure.js`, the
   guard test, this ticket's own step handler) show only frequency-1
   co-changes with each other and the registry — below threshold, nothing
   flagged.
3. **Invariant 1** ("every file the fixture's operator_runtime.bb reaches
   by load-file, transitively and at any depth, is present in the fixture
   root before any --tick-once subprocess is spawned"): `computeClosure` is
   a plain transitive BFS over real `load-file` forms, read directly —
   matches. **Independently re-verified, not just trusted from the commit
   message**: ran `bb operator_runtime.bb --tick-once` scenario 04
   (the acceptance suite's own real subprocess run) — no
   `FileNotFoundException` naming any `.bb` file. Also re-ran the three
   feature files this defect was originally measured against:
   `BL-647-rotation-router-liveness` 7/7 (was 0/7),
   `BL-369-no-inbound-message-is-ever-lost` 6/6 (already used the fixture,
   unaffected), `BL-359-always-on-operator-presence` 7/7 (was 5/7 — one run
   showed 6/7 transiently, reran twice more and got 7/7 both times; a
   host-load flake under the live swarm's own concurrent tmux activity, not
   a fixture-load failure — the earlier failing runs' own signature was
   always the identical `FileNotFoundException`, absent here in every run),
   `BL-368-control-loss-is-not-agent-death` 3/4 (was 0/4 — the one
   remaining failure is D1, see item 6 below).
4. **Invariant 2** ("a newly introduced load-file dependency anywhere in
   that closure fails exactly one guard test, naming the file — never
   again every scenario at once"): **independently re-verified by hand**,
   not by inspection. Removed `mono_router_lib.bb` from
   `OPERATOR_RUNTIME_BB_FILES` on disk, ran
   `extension/test/operatorRuntimeBbFixtureClosure.test.js` via vitest:
   exactly the two tests that assert on the live list failed
   (`OPERATOR_RUNTIME_BB_FILES covers the real transitive load-file
   closure...` and the file's own break-then-fix test's "after restore"
   half — both correctly still referencing the mutated on-disk list), both
   naming `mono_router_lib.bb` by exact name; the other 4 tests (pure
   `directLoadFileDeps` unit checks, the `closure.has(...)` anchor, the
   undeclared-extra check) were unaffected. Restored via `cp` from an
   untouched backup, confirmed `git diff` empty, reconfirmed all 6 green.
5. **Property Testing pass** — `operatorRuntimeBbClosure.js`'s
   `directLoadFileDeps` is pure, touched, and parsing-shaped (extracts
   `.bb` filenames from `load-file` forms via regex) with only two narrow
   hand-picked examples of its own. Added
   `extension/test/operatorRuntimeBbClosure.property.test.js` (fast-check,
   pinned per engineering.prompt): a round-trip property (N random
   `.bb` filenames embedded in real `load-file` forms, interleaved with
   non-matching noise, extracted back in order) plus a "no load-file form →
   empty" property, mirroring the BL-914 `testTimeoutParser` precedent's
   own shape. Deliberately did NOT target `computeClosure`/
   `diffClosureAgainstList` — both do real fs reads, the same impure
   boundary this role excludes from property coverage. **Non-vacuity
   verified by hand**: changed `LOAD_FILE_RE`'s `\.bb` to `\.clj` (a
   plausible near-miss), the round-trip property failed immediately (empty
   extraction vs. the generated names) while the "finds nothing" property
   stayed green (a narrower-matching regex still correctly returns nothing
   on pure noise) — confirms the two properties catch complementary failure
   directions. Reverted, reconfirmed both green, ran the full
   `npm run test:properties` invocation (not just this file) — passes.
6. **The surfaced, out-of-scope defect (D1) is correctly disposed, not
   silently dropped** — independently reproduced `BL-368`'s one remaining
   failure myself (`role_lifecycle.sh`'s unpark path refusing on a
   socket-path-length guard before ever reaching the "still alive" check,
   landing on stdout not stderr): exact same error text as
   `backlog/evidence/BL-944-surfaced-defect-not-fixed-20260819.md` claims.
   Confirmed the required priority-00 notes were actually SENT, not merely
   claimed in the evidence file — found both handoffs on disk:
   `.worktrees/coder/.swarmforge/handoffs/sent/
   00_20260819T093013Z_000307_from_coder_to_specifier.handoff` and
   `..._000308_from_coder_to_coordinator.handoff`, both referencing
   `BL-944 surfaced D1`, timestamped before the git_handoff to cleaner.
   Confirmed this defect lives entirely outside BL-944's own diff
   (`role_lifecycle.sh`/`resolve_swarm_socket.bb`, neither touched here) —
   correctly out of scope per the ticket's own constraints, correctly not
   fixed here.
7. **`operator_ask.bb` drop is safe** — independently verified (not just
   trusted): grepped every consumer of `OPERATOR_RUNTIME_BB_FILES`
   (5 files, one of them this ticket's own new step handler) for
   `operator_ask` — zero hits. The 5 files that DO reference
   `operator_ask.bb` build `OPERATOR_ASK_CLI` directly from `REPO_ROOT`,
   entirely independent of this fixture list. Matches the ticket's own
   measurement exactly.
8. **No production code touched** — nothing under `swarmforge/scripts/` in
   either commit (confirmed above); the two-layer boundary, host-IO-
   ownership, webview-storage, secrets, and integrate-not-fork checks are
   not applicable (no `extension/src/` file in this diff — only
   `extension/test/`).
9. **Fixture discipline** — the new step handler
   (`bl944OperatorRuntimeBbFixtureDependencyClosureSteps.js`) builds its
   scenario-04 fixture under `mkTmp('sfvc-bl944-')` (`os.tmpdir()`,
   `mkdtempSync`) and cleans it via the same centralized `afterEach`
   shape this session already established for `bl924`/`bl631`/`bl915`/
   `bl938` — confirmed the module-level `trackedRoots` array and
   `afterEach` hook are present and correctly wired (matches the pattern
   independently verified fires-on-throw in my own BL-924 pass earlier
   today).

## Verdict

No architecture violation, no correctness defect found. Both declared
invariants independently re-verified, including by forcing failure by
hand. The pre-existing `acyclic` violation the dependency-gate reports is
unrelated and already tracked (BL-759). The one out-of-scope defect this
fix surfaced (D1) is correctly recorded and routed via priority-00 note,
verified sent. Added one property test for a previously narrowly-covered
pure parsing function, verified non-vacuous. Forwarding to hardener.

By architect.
