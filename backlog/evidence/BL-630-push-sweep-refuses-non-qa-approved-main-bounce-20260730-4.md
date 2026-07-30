# BL-630 QA bounce — 2026-07-30 (round 4, at QA)

## D1: Documenter pass missing entirely (again)

**Failing command**: no command — inspected the commit lineage directly:

```
git show 32d36ad4db --stat
git diff-tree --no-commit-id -r 32d36ad4db
```

**Commit hash**: `32d36ad4d` (the commit the documenter's `git_handoff` named,
parents `f311e4eb7d` — the BL-686 documenter branch tip — and `b92688edef`
— the hardener's BL-630 round-2 hardening commit).

**First error excerpt** (the load-bearing evidence — an empty diff-tree):

```
$ git diff-tree --no-commit-id -r 32d36ad4db
$
```

`32d36ad4d`'s own commit message is `Merge hardener b92688edef for
BL-630-push-sweep-refuses-non-qa-approved-main` — a pure merge of two
branches with **zero unique content of its own**. Same defect class as the
BL-686 bounce earlier today
(`backlog/evidence/BL-686-epic-drilldown-slug-match-bounce-20260730.md`),
now recurring on BL-630's own round-2 (post-hardening) forward: the
hardener fixed round-3's "hardener pass missing entirely" defect
(`backlog/evidence/BL-630-push-sweep-refuses-non-qa-approved-main-bounce-20260730-3.md`),
but the documenter stage that received the hardener's rework forwarded it
with no documentation pass at all.

**Failure class**: `behavior`

**Expected vs observed**: Expected a genuine documenter judgment on BL-630's
now-complete gate (`push-sweep!` refuses a non-QA-approved `main` tip) —
either real doc content or an explicit recorded "no doc needed" judgment,
per this project's own convention (BL-675 got an 88-line how-to; BL-686
earlier today got an explicit slug-identity note). Observed: no
documenter-authored commit anywhere in this round's lineage; the role was
skipped and the parcel forwarded as a bare merge.

## D2: BL-714 rode along unforwarded, and also has no documenter pass

Walking the full ancestry of `32d36ad4d` (not `--grep` filtered) turns up an
entire second ticket's work that was never given its own `git_handoff`
through this pipeline: `BL-714` ("hardening gates blocked repo-wide:
tracked vitest cache trips facilitator scan; four bridge tests bypass
mkdtemp helper"), minted and expedite-promoted directly
(`0c9e27af5`..`80c8520a5`: mint, promote, coder, architect-approval merge),
then carried forward as shared ancestry into the SAME hardener/documenter
commits that processed BL-630's round-2 rework
(`b92688edef`/`32d36ad4d`) — because this pipeline runs one shared branch
per role and BL-714 and BL-630 happened to be adjacent on it.

This is Article 2.6 territory (batch commits satisfying more than one
ticket must forward each under its own task name) — except in reverse: no
stage (coder, architect, or hardener) ever sent a `git_handoff` naming
`BL-714` as its own task. Its only trace in the handoff chain is as
untracked ancestry inside BL-630's parcel. Verified independently that
BL-714's own acceptance and gates are actually satisfied by this content
(not a rubber stamp):

- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.feature`:
  3/3 pass.
- `extension/test/tmpDirMigrationGuard.property.test.js` and
  `extension/test/rootNodeModulesCacheIgnored.property.test.js` both present
  and green (`npm run test:properties`: 30/30 files, 92/92 tests).
- `required_wiring` in `backlog/active/BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.yaml`
  fully satisfied: the tracked cache blob is removed
  (`git cat-file -e HEAD:node_modules/.vite/vitest/.../results.json` fails,
  confirmed absent from the tree, not merely re-ignored) and all four
  `telegramCursorBridge{Expedite,Logs,Redeploy,Update}.test.js` files now
  call the shared `mkTmpDir` helper instead of raw `fs.mkdtempSync`.

But `BL-714`'s own `required_stages` explicitly lists `documenter` as
required, and per D1 above, no documenter commit exists anywhere in this
lineage — so BL-714 has the same missing-documentation defect as BL-630,
compounded by never having traveled the pipeline under its own name at all.

**Failure class**: `behavior` (documentation gap) for the doc pass;
routing/identity gap (not itself bounced — noted to specifier/coordinator
separately, see remediation) for the never-forwarded ticket identity.

## Everything else checked — no other defects

Full inventory run before this bounce, all PASS:
- `npm run compile` (extension/): clean, no errors.
- Full unit suite (`npx vitest run` from `extension/`): a bare run shows
  non-deterministic cascading failures from a KNOWN, unrelated, pre-existing
  defect (`test/cursorBridgeAgentSession.test.js` leaks `CURSOR_API_KEY` via
  an unconditional `delete` instead of restore in several tests' `finally`
  blocks under `isolate:false` — see memory
  `cursor-api-key-test-leak-cascading-flake-20260730`, confirmed pre-existing
  on `main` since BL-696's `4c5c4bb2a`, unrelated to BL-630/BL-714). With
  that one file excluded: 389/389 files, 6758/6758 tests pass, deterministic
  across repeated runs — including this ticket's own scope.
- `npm run test:properties`: 30/30 files, 92/92 tests pass.
- Acceptance: BL-630 (`specs/features/BL-630-push-sweep-refuses-non-qa-approved-main.feature`)
  5/5 pass; BL-714 3/3 pass (see D2).
- Wiring: `push-decision`'s QA-ancestry gate
  (`swarmforge/scripts/push_sweep_lib.bb`) is called from the real daemon tick
  (`swarmforge/scripts/handoffd.bb:1928,1936,1939`), not merely unit-tested in
  isolation.

## Remediation pointer

Owning role: **documenter**. For BL-630: add or explicitly judge-and-record
documentation for the now-complete publish-time QA-ancestry gate (a how-to
or ops note for `handoffd`'s push-sweep behavior — this project has no
existing how-to for `handoffd` operations to extend, so a new short doc or
an explicit recorded "no doc needed, here's why" judgment is the minimum).
For BL-714: same — a short note (e.g. in a CONTRIBUTING/test-hygiene doc, or
an explicit recorded judgment) that the two hardening-gate blockers are
fixed, given its `required_stages` names `documenter` explicitly.

Separately (not part of this bounce — a `note` to specifier and coordinator,
same pass, per Article 4.4's spec-gap-adjacent handling): BL-714 has never
been forwarded through this pipeline under its own task name since it was
minted/expedited — no coder, architect, or hardener `git_handoff` ever named
`BL-714` as its `task`. When this parcel eventually clears QA, the
coordinator's bookkeeping must independently confirm BL-714's own
disposition (its ticket file is still `status: todo` in
`backlog/active/`) rather than assuming BL-630's closure covers it.
