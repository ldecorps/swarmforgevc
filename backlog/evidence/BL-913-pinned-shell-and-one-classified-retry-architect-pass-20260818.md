# BL-913 architect pass — 2026-08-18

## Scope

Received from cleaner as `merge_and_process cleaner be5ccb3721` (a batch
forward carrying BL-919, BL-625, BL-913 as three separate git_handoffs per
Article 2.6 — this evidence covers only BL-913's own work, the third of the
three parcels). The implementation is coder's commit `df92bab8d` (pin a
role's shell + heal one classified retry, in silence); cleaner's own commit
`be5ccb3721` ("Cleanup BL-913: guarantee temp-dir cleanup on failure in
tool-miss-heal test runners") touches this ticket's own test runners
(`tool_miss_heal_acceptance_runner.bb`, `tool_miss_heal_lib_test_runner.bb`)
with a scoped try/finally + shutdown-hook cleanup fix, unrelated to the
classify/heal decision logic itself — reviewed as part of this pass since
it is in this ticket's own file set.

Files reviewed (`git show --stat df92bab8d` plus cleaner's follow-up):
- `swarmforge/scripts/tool_miss_heal_lib.bb` (new, pure)
- `swarmforge/scripts/tool_miss_heal_hook.bb` (new, thin I/O boundary)
- `swarmforge/scripts/swarmforge.sh` (pin export + hook wiring into
  generated settings.json)
- `swarmforge/scripts/test/tool_miss_heal_lib_test_runner.bb`
- `swarmforge/scripts/test/tool_miss_heal_lib_property_runner.bb`
- `swarmforge/scripts/test/tool_miss_heal_acceptance_runner.bb`
- `swarmforge/scripts/test/test_tool_miss_heal_hook_wiring.sh`
- `swarmforge/scripts/test/test_model_factory_runtime_wiring.sh` (existing
  scenario 02 updated for the new root-specific hook path)
- `specs/pipeline/steps/bl913PinnedShellClassifiedRetrySteps.js`
- `specs/pipeline/steps/index.js`

## Checks run (complete inventory, not first-failure-stop)

1. **Pure/impure split (Article 1.5)** — `tool_miss_heal_lib.bb` has zero
   I/O: `classify-miss`, `healed-command`, `build-healing-wrapper-command`
   are pure string/regex functions, never reading ambient cwd/env (grepped
   for `fs/cwd`/`System/getProperty` — absent). All I/O (`slurp`/`println`
   on stdin/stdout, `System/getenv`) lives in `tool_miss_heal_hook.bb`, the
   thin PreToolUse boundary that delegates every decision to the pure lib.
2. **Fails-open correctness** — traced `tool_miss_heal_hook.bb`: malformed
   JSON, a non-Bash tool, a missing command, or an unset/blank
   `SWARMFORGE_ROLE_WORKTREE` all hit `pass-through!` (prints `{}`, changes
   nothing) before the pure lib is ever called. A bug in this hook degrades
   to pre-BL-913 unhealed behavior, never to a blocked tool call — matches
   the file's own stated contract. Verified live via
   `test_tool_miss_heal_hook_wiring.sh` (below).
3. **Generated-bash correctness read** — traced
   `build-healing-wrapper-command`'s output by hand: original command runs
   first unconditionally; the classify if/elif chain (mirroring
   `classify-miss`'s own first-match-wins order) only enters on nonzero
   exit; at most one clause fires (if/elif, not independent `if`s) so a
   healed re-run that fails the SAME way again is never re-entered into the
   chain — this holds structurally, not by convention. `printf '%s'
   "$__sfh_out" | grep -qiE` (never bare `printf "$var"`) avoids
   format-string interpretation of arbitrary captured output. Single-quote
   escaping in `shell-quote` is the standard `'\''` pattern, applied to
   `pinned-worktree` and the grep patterns; the original command is spliced
   unquoted by design (it must be interpreted as shell, not a literal).
4. **Pin provenance (invariant 2) wiring** — `swarmforge.sh`'s launch
   script now exports `SWARMFORGE_ROLE_WORKTREE='$role_worktree'` from the
   SAME variable its own `cd '$role_worktree'` line already uses (not
   `roles.tsv`, which BL-846 already established is fictional under
   mono-router) — confirmed by reading the diff directly, not just the
   commit message's claim.
5. **`write_claude_settings_file`'s hooks_block JSON** — traced all three
   settings-file branches (permission-mode, resolved-model,
   effort-only); each appends `$hooks_block` as the final top-level key
   with a comma added to the preceding field, producing valid JSON in all
   three shapes (verified by reading the heredocs directly).
6. **Declared invariants (3, per the ticket YAML) — Invariants Review**:
   - Invariants 1 and 3 are both encoded as generator-based property tests
     with independent oracles
     (`tool_miss_heal_lib_property_runner.bb:159-182`, `runs`=150 default).
     The file's own explicit non-vacuity mutant (`mutant-double-retry-wrapper`)
     only demonstrates invariant 1's non-vacuity (invocation count 3 vs 2);
     I independently verified invariant 3 is also non-vacuous rather than
     taking that on faith — wrote a throwaway mutant that concatenates the
     healed re-run's output onto the first attempt's instead of replacing
     it (the exact "mix" bug invariant 3 forbids) and confirmed the
     property's own oracle check catches it: `out` came back as
     `"fatal: not a git repository...HEALED-OK"` against an expected
     `"HEALED-OK"`, which the predicate's `(not= out expected-marker)`
     branch correctly flags. Not vacuous.
   - Invariant 2 (pin provenance) carries a STATED non-encodability reason
     in the property runner's own header comment: the pure functions take
     `pinned-worktree` as an explicit argument and read no ambient cwd/env
     inside the module (grep-confirmed absent), so "derived from the
     explicit argument, never ambient state" is a property of the
     function signature itself, not something a randomized generator adds
     power to prove — backed instead by direct example tests in
     `tool_miss_heal_lib_test_runner.bb` (`healed-command: wrong-cwd cd's
     into the pinned worktree`, `wrong-surface cd's into the pinned
     worktree's extension/ subdirectory`, plus the wiring test's real
     drifted-cwd-heals-via-the-pin scenario). Verified these example tests
     genuinely exist and exercise the claim, not just asserted by the
     commit message.
7. **Dependency-rule gate (BL-259 hard gate)** — all of this ticket's
   changed files are under `swarmforge/scripts/`, none under
   `extension/src/`; `dependency-gate.js` errors immediately (scan root is
   `extension/`, no applicable TS ruleset). Same structural N/A as every
   other babashka-only parcel this session (BL-919, and BL-891/BL-848
   before it).
8. **Co-change coupling (BL-255)** — the two new files
   (`tool_miss_heal_hook.bb`, `tool_miss_heal_lib.bb`) co-change only with
   their own sibling test/step files — expected for brand-new files.
   `swarmforge.sh` co-changes broadly, its well-documented baseline as the
   launch-script hub every settings/wiring change touches; nothing
   cross-boundary.
9. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: no tile/webview code touched, no
   VS Code extension code at all. This is fork-maintenance on the daemon's
   own launch/hook machinery.
10. **Acceptance (BL-233)** — live `.feature` (not `.draft`), step handlers
    registered in `specs/pipeline/steps/index.js`. Ran directly (below):
    6/6 concrete cases pass (4 scenarios, one an Outline with 3 cases).
11. **External hook-contract risk, noted not gated** — the actual Claude
    Code PreToolUse `hookSpecificOutput.updatedInput.command` contract is
    unprecedented elsewhere in this repo (no prior PreToolUse hook to
    compare against); this parcel's own wiring test proves the generated
    bash, once produced, heals correctly when executed, but proving Claude
    Code itself honors the rewrite live is explicitly the ticket's own
    `qa_e2e_procedure` (against a live swarm pane) — correctly QA's job,
    not an architecture concern.
12. **Property-testing pass (own section)** — all three declared invariants
    already carry coverage per #6; no additional undeclared-property gap
    found on the touched pure module beyond what the ticket's own
    invariants require. No new property test added; none needed.

## Tests re-run independently (all green)

- `bb swarmforge/scripts/test/tool_miss_heal_lib_test_runner.bb` → ALL
  TESTS PASS
- `bb swarmforge/scripts/test/tool_miss_heal_lib_property_runner.bb` →
  non-vacuity confirmed (invariant 1's own mutant), ALL PROPERTIES HOLD;
  invariant 3's non-vacuity independently re-verified via a throwaway
  mixing-mutant probe (see #6 above, not committed — scratch verification
  only)
- `bash swarmforge/scripts/test/test_tool_miss_heal_hook_wiring.sh` → 7/7
  scenarios PASS (non-Bash pass-through, unset-pin pass-through, malformed
  JSON pass-through, known-pin rewrite, non-empty rewrite, real drifted-cwd
  heal, output is the healed result only)
- `XDG_RUNTIME_DIR=<short tmp dir> bash
  swarmforge/scripts/test/test_model_factory_runtime_wiring.sh` → 7/7 PASS
  (the default `$TMPDIR` on this host exceeds the unix-socket path length
  limit unrelated to this commit — an environment quirk, not a defect;
  scenario 02's new per-fixture-root path normalization confirmed intact)
- `node specs/pipeline/cli.js
  specs/features/BL-913-pinned-shell-and-one-classified-retry.feature` →
  6/6 concrete cases pass

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Forwarding to hardender.

By architect.
