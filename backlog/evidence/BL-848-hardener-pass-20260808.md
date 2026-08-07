# BL-848 — hardener pass — 2026-08-08

## Received

`git_handoff` from architect (`merge_and_process architect 6fc6b5a18a`),
carrying cleaner's clean pass (`3d5c1e7b68`, no defects) merged into the
architect branch. Merged into `swarmforge-hardender` clean; two pre-existing
untracked files blocked the merge only because they were byte-identical to
what the incoming commit itself carried (`process_table_lib.bb` and its test
runner) — removed and let the merge recreate them, no content lost. A third
pre-existing untracked file, `operator_path_lib.sh`, matches paused BL-796
(same documented precedent the cleaner's own evidence records) — left alone,
not staged, not this ticket's to touch.

## Re-verification (all four suites the cleaner ran)

1. Unit — `bb swarmforge/scripts/test/hotfix_certification_lib_test_runner.bb`: ok.
2. Property — `bb swarmforge/scripts/test/bl848_hotfix_certification_property_runner.bb`: ok.
3. Wiring smoke — `bash swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`: 12/12 passed.
4. Gherkin acceptance — `node specs/pipeline/cli.js specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature`: 10/10 passing.

Host load 4.55 on 4 cores (`/usr/sbin/sysctl -n hw.ncpu`) — not the
>>2x-cores condition, no need to defer.

## Tooling (Startup Tools table)

This parcel is entirely `.bb` (Babashka) plus one new bash CLI-wiring test —
no `.ts`/`.kt` surface touched. Per the Startup Tools table, mutation/CRAP/DRY
are not wired for `.bb`; the gate is the unit/property/wiring/acceptance
suites above, matching the cleaner's own scoping.

## Coverage-gap hardening (this pass's actual work)

Reviewed every file this parcel's diff touches for real, not merely
plausible, gaps — not the ledger/state-machine core the cleaner already
confirmed is fully covered (parse/render round trip, all 8 acceptance
scenarios, the R1 unaccounted-commit predicate, resurfacing/dedup), but the
two pieces the coder folded in to unblock its own test sandbox that had *no*
coverage of their own before this ticket:

1. **`hotfix_ledger_update.bb` had zero test coverage anywhere** — grepped
   `specs/`, `swarmforge/scripts/test/`, `docs/` before writing anything;
   the only hits were the how-to's own usage examples. This is the *one*
   mechanical tool a human runs to record the two durable, non-derivable
   ledger facts (commit→stamp-ticket link, certify/waive decision) —
   invariant 3's human-ask gate is only as trustworthy as this CLI's own
   correctness, and a silent corruption or a wrongly-accepted malformed
   input here would land straight in the committed ledger. Added
   `swarmforge/scripts/test/hotfix_ledger_update_test_runner.sh` (20
   checks): `--new` add + duplicate-commit rejection (ledger untouched,
   never a second entry); `--link` on a known vs. unknown commit (unknown
   fails loudly, ledger byte-for-byte unchanged); `--decide approved` and
   `--decide waived` (including a waiver on an entry with no stamp ticket
   at all — the ticket's own "documented operator knob... waived candidate"
   case, by design, not a bug); a case-mismatched decision word
   (`Approved`) is rejected outright rather than silently accepted or
   defaulted (the "malformed-but-present optional field" class of gap);
   and the no-mode/missing-subject usage paths exit nonzero rather than
   crashing. All 20 pass.
2. **`process_table_lib.bb`'s own first-ever test (added by this ticket's
   coder to unblock the sandbox helper) was a 3-assertion smoke test** —
   `cwd!`, `list-pids!` (only exercised indirectly via `list-processes!`),
   and nonexistent-pid behavior for every function were untested. Extended
   `process_table_lib_test_runner.bb`: `list-pids!` includes this JVM's own
   pid; `list-processes!` never yields a blank-cmdline entry;
   `cmdline!`/`age-ms!`/`cwd!` for a pid that does not exist on this host
   degrade gracefully (empty string / 0 / nil-or-blank) rather than
   throwing — load-bearing for the orphan-agent-reaper sweep, which calls
   these on live-scanned candidate pids one of which may exit between
   enumeration and inspection; `cwd!` for self is asserted only against its
   own documented contract (nil-or-non-blank-absolute-path — Darwin's lsof
   branch is host-PATH-dependent, so a hard non-nil assertion would be
   testing this sandbox's PATH, not the function). All checks pass on this
   host (macOS, Darwin `procfs-available?` branch confirmed false).

Both files are pre-existing, already-live-on-`main` code from the Darwin
orphan-janitor hotfix (`f9cf29c2`) that this ticket's coder pulled in only to
fix its own test sandbox helper's copy-list (see the coder's commit message
and `operator_runtime_sandbox.sh`'s own `# BL-849` comment) — not new product
behavior BL-848 introduces. Deeper correctness review of the reaper logic
itself (e.g. whether `cwd!`'s `lsof`-unavailable case is handled safely by
every caller) is `f9cf29c2`'s own stamp-off, ticketed as **BL-849** — out of
scope here per this ticket's own "First debt" section, which explicitly
routes that review to BL-849 rather than loading it onto this parcel. Noting
it here only so the observation is not lost before BL-849 is worked.

## Cleanup / leftover-process check

Two leaked fixture tmux servers were found under the OS temp dir (socket
paths under `$TMPDIR/tmp.*/aps-stale-orphan/role.sock`, distinct from the
real swarm's `.swarmforge/tmux/*.sock` — discriminated by socket path per
the BL-807 lesson, never by session name) — killed via
`tmux -S <socket> kill-server`, each individually. The real swarm's own
`swarmforge-coder` session (repo-rooted socket) was left untouched. No
orphaned `node --test`/`stryker` processes found (`pgrep -afl`).

## Verdict

No defects found in the ledger/state-machine core the cleaner already
verified. Two real coverage gaps closed (a previously-untested CLI, and a
previously-smoke-only cross-platform lib's first test), 26 new checks total,
all passing. Forwarding to documenter.

By hardener.

---

## Re-pass, same date — after QA bounce fix + architect re-review

`git_handoff` from architect (`merge_and_process architect 1e62fbdc3d`),
carrying QA's bounce (`backlog/evidence/BL-848-qa-bounce-20260808.md`, D1:
blank `detected_at` on sweep-appended ledger entries), the coder's fix
(`4eaa77594b`: `git-log-main` now captures the commit date via
`--date=format:%Y-%m-%d`/`%cd`, threaded through `resolve-main-commits` with
a now-ms fallback), and the architect's clean re-review (`1e62fbdc3d`).
Merged cleanly into `swarmforge-hardender`.

### Re-verification

1. `swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
   — 13/13 pass (12 from the original pass + the coder's new non-vacuous
   regression check: sweep-appended `detected_at` is a real `YYYY-MM-DD`,
   never blank — the exact bounce).
2. `hotfix_ledger_update_test_runner.sh` — 20/20 pass (unaffected by this
   delta; re-run for regression).
3. `hotfix_certification_lib_test_runner.bb`,
   `bl848_hotfix_certification_property_runner.bb` — pass (unaffected;
   re-run for regression).
4. `run_acceptance.sh specs/features/BL-848-....feature` — 10/10 scenarios
   pass.
5. **Gherkin mutation (BL-113), soft — gap closed this pass.** The feature
   has two `Scenario Outline`s and had never been run through
   `run_gherkin_mutation.sh` (no manifest present in the file before this
   pass — my first pass above hardened the CLI/lib coverage gaps but did not
   yet reach this gate). Ran it: 6/6 mutants killed (both Outlines' every
   example value), 0 survived, 0 errors. Manifest now embedded in the
   feature file (committed alongside this evidence).

### Gap assessed and not pursued

`resolve-main-commits`' `(or % (ms->ymd now))` fallback (only exercised if
`git-log-main`'s own date capture ever comes back blank — the branch is
explicitly commented "should-never-happen") has no direct unit-level test.
`operator_runtime.bb` calls `(-main)` unconditionally at file scope with no
test-mode guard, so — consistent with every other private helper in this
2100+-line file — it is reachable only through the wiring-level
`--tick-once` harness, never a `load-file`d unit test. Extracting it into a
loadable lib for this one defensive fallback would be a structural change
beyond a hardening pass's remit; the actual bug this ticket exists to catch
(a genuinely blank date reaching the ledger) is now covered non-vacuously by
check 1 above.

### Cleanup

No leaked fixture tmux servers this pass (checked by socket path, BL-807
lesson); the live swarm's own `swarmforge-coder` session (repo-rooted
socket) is the only tmux server present. No orphaned `node --test`/`stryker`
processes. Untracked `swarmforge/scripts/operator_path_lib.sh` (paused
BL-796) left untouched, not staged.

### Verdict

No defects. Forwarding to documenter.

By hardener.
