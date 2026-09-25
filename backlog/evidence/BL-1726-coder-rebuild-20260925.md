# BL-1726 — coder rebuild pass (specifier send-back D1), 2026-09-25

Specifier send-back (backlog/evidence/BL-1726-bounce-20260925.md, ticket
commit 4835432d01, routed via coordinator git_handoff from parcel commit
9c10e2985f): D1 (invariant-unencoded) blamed on coder, D2 and D3 already
disposed by the specifier (D2 ratified into an earlier parcel already on
this branch, D3 struck) - nothing left for either here.

## D1 — built

`extension/test/bl1726OllamaLlamaServerOwnershipMarks.property.test.js`
(new). Drives the real `orphan-janitor-lib/reapable-ollama-ghost?`
(`swarmforge/scripts/orphan_janitor_lib.bb`) over the full 64-case
constructed command-line space named in the send-back: executable (ollama
lib dir / llama.cpp build / PATH-resolved / `ollama runner`) x model
(ollama blob / other path) x parent liveness x live-window flag x age, all
64 cases evaluated in one bb process (BL-1724's per-file-cost lesson).
Ground truth (`marksExecutable`/`marksModel`) is hard-coded independently
per case, never re-derived from the predicate under test - the file's own
comment records that a first draft computing "expected" via the predicate
itself passed unchanged against a dropped `--model` check, which is why
this shape was chosen. Asserts the declared invariant directly (a reaped
llama-server always carries both marks) plus full case-by-case equality
against `reapable-ollama-ghost?`'s real `cond` branches, and a reach-floor
count (64 = 4 executables x 2 models x 2 x 2 x 2).

Non-vacuity, checked directly (not left in the commit): temporarily
dropped the executable-path mark from `ollama-own-llama-server-cmdline?`
in `swarmforge/scripts/orphan_janitor_lib.bb` (the file was clean/tracked,
so `git checkout --` restored it afterward with no stash needed) and
re-ran the test - it failed on the first llama.cpp-build/ollama-blob case
(`true !== false`, the file previously reaping a hand-started llama.cpp
server once its model happened to be an ollama blob). Restored the real
predicate immediately after and re-ran green.

`npm run test:properties` on this file alone: 1 test file, 1 test, green
(~0.3s).

## D2 / D3 — already disposed, nothing rebuilt

Both were disposed by the specifier's ratification/strike, already
reflected on this branch from the documenter's earlier parcel (9c10e2985f)
this rebuild routes from. No code change for either in this commit.

## Verification run before forwarding (2026-09-17 rule: once each)

- `npm test` (extension/, compile + unit lane): 637 files, 10867 tests,
  exit 0.
- `npm run test:properties` (this file, once): green.
- `run_acceptance.sh` on BL-1726's own feature: 5/5.
- `run_acceptance.sh` on the neighbouring BL-1705 feature
  (qa_e2e_procedure step 2): 8/8, unchanged.
- `bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb`: ALL
  CHECKS PASSED.

## Scope

Touched: `extension/test/bl1726OllamaLlamaServerOwnershipMarks.property.test.js`
(new, exactly the send-back's named D1 deliverable), this evidence file.
Nothing else in this worktree was staged for this commit - the unrelated
untracked leftovers present in this worktree (BL-1666/BL-1652) are not
this ticket's and are left as found.

By coder.
