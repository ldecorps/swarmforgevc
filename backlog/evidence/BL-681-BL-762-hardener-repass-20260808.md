# Hardener re-pass — BL-681, BL-762 (2026-08-08, QA-bounce re-entry)

## Context

Received a batch of two `git_handoff`s from architect: task BL-681 (commit
`d642bc1ca8`) and task BL-762 (commit `3670aa6e4c`). `d642bc1ca8` is an
ancestor of `3670aa6e4c`, so a single `git merge 3670aa6e4c` (clean, no
conflicts) covers both — merged as one combined working set per batch mode.

This is a re-entry after QA bounced BL-681 and BL-762 (not BL-574, sibling
deferral — see `backlog/evidence/BL-681-BL-762-qa-bounce-20260808.md`) for
two defects following my prior hardener pass
(`backlog/evidence/BL-574-BL-681-BL-762-hardener-pass-20260808.md`,
commit `b2cd357f`):

- **D1** (BL-762): `swarmforge/scripts/finish_shift_lib.sh` references the
  retired `onboarding-facilitator-supervisor.pid` name (legitimate dual-clear,
  same pattern as two already-allowlisted scripts) but was not itself
  allowlisted in `extension/test/onboarderResidualAllowlist.js`.
- **D2** (BL-681): the ticket's own `acceptance:` YAML field still pointed at
  `.feature.draft` after the file was promoted to `.feature`; the existing fix
  (`a60906ea`) had not been merged into the lineage that reached QA.

## Fix verification (against the merged tree, `main:backlog/evidence/BL-681-BL-762-qa-bounce-20260808.md`)

- D1: `extension/test/onboarderResidualAllowlist.js:28` now lists
  `'swarmforge/scripts/finish_shift_lib.sh'`. Confirmed `a60906ea` and
  `64ed4868` (the actual rename + cleaner re-pass) are both now ancestors of
  HEAD (`git merge-base --is-ancestor a60906ea HEAD` → true).
- D2: `backlog/active/BL-681-consolidation-never-drops-a-human-sentence.yaml`
  `acceptance:` now reads
  `specs/features/BL-681-consolidation-never-drops-a-human-sentence.feature`,
  which exists; `.feature.draft` is gone.

## Applicability scan — this re-entry's own delta

`git diff --name-only b2cd357f..3670aa6e4c` (the actual incremental change
carried by this re-entry, since `finish_shift_lib.sh` and the `.feature` file
content were already unchanged between my prior HEAD and this merge — see
`git diff --stat b2cd357f 3670aa6e4c -- extension/test/onboarderResidualAllowlist.js
swarmforge/scripts/finish_shift_lib.sh specs/features/BL-681-*.feature`,
empty): two ticket YAMLs (metadata only), three evidence `.md` files, two doc
files, and `extension/test/onboarderResidualAllowlist.js` (+1 line, a test
allowlist array entry — test infrastructure, not application logic). No
`.ts` files touched. Stryker, CRAP, jscpd are all inapplicable to this delta
by scope (engineering.prompt Startup Tools table). No new `.bb`/`.sh`
production logic in this delta either — the BL-149 cooldown gate has nothing
new to evaluate here.

## Verification re-run

- `bash swarmforge/scripts/test/test_finish_shift_lib.sh` — PASS=11 FAIL=0.
- `run_acceptance.sh specs/features/BL-681-*.feature` — 3/3 green.
- `run_acceptance.sh specs/features/BL-762-*.feature` — 14/14 green.
- `cd extension && npm test` — 408/411 files, 7286/7292 tests pass. The 6
  failures are all in `dependencyGateCli{CleanAndViolations,ReportsAndScope,
  StorageGlobals}.test.js`, all failing identically with `Your node version
  (20.20.2) is not supported. dependency-cruiser requires ^22||^24||>=26` —
  a host Node-version mismatch, unrelated to and pre-dating this batch (same
  environmental class already noted in the earlier pass's `test_prompt_engine_lib.sh`
  pre-existing-failure finding). None of the three failing files, nor
  `dependency-cruiser`, are touched anywhere in this batch's diff.
- Environment check post-run: `pgrep -fl 'node --test|stryker'` and
  `pgrep -afl tmux` clean — only the live swarm's own repo-socket
  `swarmforge-coder` session present, no leaked fixture tmux servers.

## CRAP / DRY

Not applicable — no `.ts` files in scope for this re-entry (see Applicability
scan above).

## Conclusion

Both QA-bounced defects (D1, D2) verified fixed in the merged tree. No new
production logic in this re-entry's own delta to mutation-test; prior pass's
mutation deferral for the underlying `.bb`/`.sh`/feature files still stands
(busy-host, unchanged files). All suites green except the pre-existing,
unrelated Node-version environmental failure. Forwarding BL-681 and BL-762 to
documenter, each as its own `git_handoff` per Article 2.6, both naming this
commit.

By hardener.
