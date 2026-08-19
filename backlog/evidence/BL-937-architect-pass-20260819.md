# BL-937 architect pass — 2026-08-19

## Reviewed commit
`d3e98df25a1a3db8d3c8d9ad9b4cf521a5ff28ca` ("BL-937: port six bash-4-only
shell scripts to run on stock macOS bash 3.2", By coder, forwarded
unchanged by cleaner — verified via `git diff d3e98df25a 82f23e306` showing
only unrelated later-merged tickets, no cleaner edits to this ticket's own
files).

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: no extension/ file is in this parcel's diff
   (`git show --stat` confirms the 10 changed files are all shell scripts,
   a step-handler JS file under `specs/pipeline/steps/`, and an evidence
   markdown — none under `extension/`), so per-parcel mode has nothing to
   scan. Ran full-repo mode anyway as a defensive check: it reports a
   3-edge `acyclic` cycle in `telegram-front-desk-bot.ts` /
   `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`.
   Confirmed pre-existing and unrelated: `git log -1` on those three files
   shows they were last touched by an unrelated hardener pass
   (619fe5226), and the cycle is already tracked at
   `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
   Not this parcel's defect, not blocking.
2. **Co-change report**: ran against all 9 non-evidence changed files.
   Every reported pair sits at frequency 1 — below the default
   suspected-coupling threshold (3). Nothing flagged.
3. **Invariant 1** ("a port preserves behaviour exactly... including the
   empty-output case, the final-line-no-newline case, and spaces/tabs/
   backslashes preserved verbatim"): read
   `test_bl937_portable_mapfile_replacement.sh` in full — 6 cases covering
   exactly these edge cases against `mapfile`'s documented contract (no
   live `mapfile` on this host to diff against directly, correctly
   reasoned). Ran it myself under the real `/bin/bash` (3.2.57): 6/6 pass.
   Independently re-verified non-vacuity myself, not just trusting the
   commit message: removed the `|| [[ -n "$line" ]]` final-line guard from
   a scratch copy — case 03 failed exactly as expected ("expected 2
   element(s), got 1"), confirming the test bites. Reverted the scratch
   copy (never touched the tracked file); working tree stayed clean.
4. **Invariant 2** ("nothing outside the six named files changes
   behaviour... no production logic is rewritten while passing through"):
   confirmed via `git show --stat d3e98df25a` — only the six named
   scripts, the ticket's own step handler + `index.js` registration, the
   new invariant-proof test, and the surfaced-defects evidence file
   changed. Read each of the six scripts' diffs directly: every hunk is a
   1:1 `mapfile`→read-loop or `${var^^}`→`tr` substitution at the exact
   line the ticket's own inventory named, no argument/diagnostic/exit-code
   changes, no other logic touched.
5. **Invariant 3** ("safe under `set -u`... must not reintroduce BL-801's
   failure mode"): audited all 12 real replacement sites by hand across
   the six diffs, not just the standalone test. Every site is either a
   single-index access (`${FIX_A[0]}`), a length check via `${#arr[@]}`
   (safe under `set -u` even when empty — arithmetic/count expansion, not
   `@`/`*` bulk expansion), or already carried a pre-existing `${arr[*]:-}`
   fallback the port left untouched (`smoke_check_stabilize_two_pack.sh`).
   None bulk-expands a possibly-empty array without a guard. Confirmed
   `set -u` is actually active (`set -euo pipefail`) in all three operator/
   smoke scripts that carry it.
6. **Independently ran all three previously-never-executed wiring tests**
   under the real `/bin/bash` (not the vestigial `timeout`-wrapped
   invocation I first tried — this host's `/bin/bash` has no `timeout`
   builtin, unrelated to the port):
   - `test_handoffd_priority_rotate_wiring.sh`: 4/4 PASS, matches claim.
   - `test_handoffd_starve_rotate_wiring.sh`: 4/4 PASS, matches claim.
   - `test_handoffd_aged_note_rotate_wiring.sh`: FAILS exactly on
     `chase-rotate-error cleaner not-a-rotation-router` in scenario A —
     matches D1 in the surfaced-defects evidence file byte-for-byte. The
     port itself is not implicated: the failure is a rotate-gate refusal,
     orthogonal to array-reading semantics.
7. **Scenario 02's static scan, independently reproduced** (own grep, not
   the step handler's JS): stripped comment lines from every tracked
   `*.sh` file and grepped for `mapfile`/`readarray` and case-converting
   expansion. Exactly one hit, in exactly the file the step handler's
   `KNOWN_SAFE_OCCURRENCES` names:
   `test_route_backlog_role_label_bash32.sh`'s own scenario 03, which
   embeds `${ROLE^}` as a literal string handed to a nested `bash -c`
   subprocess specifically to prove bash 3.x *rejects* it — read the
   surrounding lines directly, confirmed it is a deliberate negative-test
   fixture, not a live construct usage, and the outer script itself never
   evaluates it. The flagged judgement call is sound; no weakening of the
   general regex was needed or taken.
8. **Scenario 03's fixture-driven checks**: `REEXPEDITE_DRY_RUN=1` used by
   the step handler is a pre-existing flag already documented in the
   script's own usage header (`grep -n REEXPEDITE_DRY_RUN` confirms it
   predates this port) — the step handler exercises existing behaviour,
   introduces none.
9. **Step handler honesty check**: read
   `bl937ShellScriptsRunOnStockMacosBash32Steps.js` in full. The "it
   reports every scenario passing" step asserts a literal `ALL PASS:
   <name>` regex match for all three wiring tests, including the
   aged-note one — no special-casing, no weakened assertion for the known-
   failing row. Matches the commit's own claim of "6/7 scenarios pass, one
   expected failure, not hidden, not weakened."
10. **D1/D2 surfaced-defects evidence**
    (`BL-937-surfaced-defects-not-fixed-20260819.md`): reproduced both
    independently. D1 confirmed above (item 6). D2
    (`smoke_check_stabilize_two_pack.sh` profile/expectation drift):
    root-caused correctly, verified the port's read-loop reads the
    identical two role names the file's own `grep`/`awk` extraction would
    - not a port defect. Both correctly scoped out per the ticket's own
    constraints and left for a `note`, not folded into this parcel.
11. **Property Testing pass**: the parcel touches no pure JS/TS module —
    only shell scripts and an acceptance step-handler file that drives
    real subprocesses (`specs/pipeline/steps/`, outside the fast-
    generative-property boundary). `test_bl937_portable_mapfile_replacement.sh`
    already serves as the equivalent verification for the shell-portability
    invariants (checked under items 3/5 above). No new fast-check property
    test is warranted; none manufactured.
12. **Module boundaries / two-layer architecture**: not implicated — no
    extension host/webview code touched, no I/O ownership changed, no new
    process spawned bypassing tmux, no secrets, no webview storage.

## Verdict
No architecture violation, no invariant violation, no correctness defect.
All three declared invariants hold, independently re-verified (including
invariant 1's non-vacuity, reproduced myself rather than only trusting the
commit message, and invariant 3's full 12-site hand-audit, not just the
standalone test). The two out-of-scope defects (D1, D2) were correctly
surfaced-not-fixed per the ticket's own constraint and are the specifier/
coordinator's to pick up via the accompanying note, not this parcel's.
Forwarding to hardener.

By architect.
