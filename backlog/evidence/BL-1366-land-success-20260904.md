# BL-1366 — LAND SUCCESS, 2026-09-04

Landing an approved commit is one command. `land_main_publish.sh`
documented a caller protocol nothing implemented — acquire the land lock,
decide, rematch if advised, push FF-only, release — and QA hand-ran all
four steps after every approval, alongside `land_step_cli.bb` for the
entanglement verdict and `issue_done.sh` for a `GH-`-seeded ticket. A new
`--land <task-name> <approved-commit> [<issue-ref>]` mode performs the
whole documented sequence as one command.

## Verification (QA worktree, merged documenter tip)

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1366_land_is_one_command.sh` —
  21/21 PASS: no-force push, lock released on every exit path, exactly
  one rematch (never a second), a bounded lock wait (4s in the fixture,
  never unbounded), an escalation leaves `origin/main` byte-identical and
  the lock unheld, a `GH-`-seeded ticket's issue closes on success, a
  ticket with no issue ref attempts no issue call, the live repository's
  origin URL and remotes untouched.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1366's feature — 9/9
  (5 plain `Scenario` + 1 `Scenario Outline` with 4 examples = 9 runnable,
  matching the feature file's own count exactly).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `required_wiring` anchor confirmed present by grep: `registerSteps`
  (BL-1371); no production log-label anchor declared (its own yaml notes
  why).
- `node extension/out/tools/qa-sibling-check.js status --ticket BL-1366`
  — `VERIFY BL-1366`, no open deferral.
- No `extension/src` touched — CRAP/DRY N/A.
- Hardener independently spot-mutated the no-force-push guard
  (`land_push_ff_only`) and confirmed it is genuinely load-bearing, not
  vacuous. BL-113 Gherkin mutation: 4/4 killed (embedded manifest
  confirmed per BL-460).
- Full ancestry chain confirmed via `git merge-base --is-ancestor`: coder
  (`48a2e6dae9`), cleaner (`b48b9cd600`), architect (`b7bfd08199`, clean
  sweep, no bounce), hardener (`7479e721cd`), documenter (`1c051d73d5`)
  all confirmed ancestors of the merged tip (`de6e4a2b0b`).
- No orphaned test/mutation processes before or after.

## Reviewed the new `--land` mode's implementation directly

Read the full diff to `land_main_publish.sh` before approving, since this
tool is what QA itself now depends on for every future land: entanglement
verdict is checked FIRST, before the lock is even taken, so an escalation
never holds it; the lock has a bounded deadline
(`LAND_LOCK_WAIT_SECONDS`/`LAND_LOCK_POLL_SECONDS`, default 120s/2s), never
an unbounded spin; a `trap ... EXIT INT TERM` releases the lock on every
exit path, including a signal; a rejected push rematches onto the CURRENT
origin tip exactly once (`git rebase origin/main <sha>`) then retries,
and a second rejection stops rather than rematching again or forcing;
`land_push_ff_only` contains no `--force`/`-f` anywhere (grepped
directly). This is a coherent, well-tested addition — no unrelated
ticket's content present in this diff at land time.

**Not yet adopted for this land itself**: the tool cannot be authoritative
for its own approval until it has landed clean once, so this parcel used
the manual four-step sequence (as documented, still available as the
fallback route per this ticket's own how-to update). Intend to use
`--land` for subsequent tickets in this session going forward, now that
it is verified live on `origin/main`.

## QA worktree hygiene: fixed a stray Specification.MD duplication

While merging this parcel in, found `docs/reference/Specification.MD`
carried a full duplicate of BL-1390's entry (once correctly positioned in
the current landing-order chain, once stranded mid-file right after
BL-1363's entry with no separator and skipping straight to BL-1362).
Traced to this session's own earlier back-merges (confirmed via `git show
<commit>:docs/reference/Specification.MD | grep -c` across each of this
session's landed commits — every commit actually pushed to `origin/main`
carried exactly one BL-1390 entry; the duplicate existed only in local
QA-worktree merge history, most likely from a 3-way merge on prose content
that could not tell two independently-prepended-but-textually-similar
insertions apart). Removed the stranded duplicate block before continuing;
verified `origin/main` itself was never affected (confirmed clean before
touching anything).

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1366`, off `origin/main` (which
had again advanced past this session's BL-1361 land by land time,
confirmed via `git worktree add origin/main` picking up the current tip
directly — `tip-contains-origin true`, clean fast path).

Own paths: the 8 BL-1366-named files (ticket yaml, 5 evidence files,
feature file, step handler, e2e suite) plus `land_main_publish.sh` itself
(3 hunks, all one coherent addition — the header usage note, the new
`--land`/`run_land` implementation block, and the `case` dispatch entry)
and a modification to the existing `docs/how-to/BL-1144-...md` page
(extending it in place with the new `--land` documentation, two clean
hunks). `docs/index.md` and `docs/reference/Specification.MD` needed the
same single-line/prepended-entry treatment as every prior land this
session. `swarmforge/scripts/test/suite-manifest.tsv` needed one new row.

No accidental mode changes — checked `git ls-tree origin/main` for
`land_main_publish.sh` before touching it (non-executable, matches the
QA-worktree's own copy, no chmod needed).

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1366_land_is_one_command.sh` —
  21/21 PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1366's feature — 9/9.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `required_wiring` anchor re-confirmed present by grep.
- `git diff --diff-filter=D origin/main --cached` — no deletions.
- No orphaned test/mutation processes before or after.

## Landed

- Tip-pure commit `4260034a36` off `origin/main` at `2be0a2f62d`.
- `land_main_publish.sh --decide-only` (lock not held during the decision
  call) read `:lock-admission :admit`, `:next :push`,
  `origin-advanced-since-gate: false`. Acquired the lock, pushed
  `2be0a2f62d..4260034a36`, verified with `git ls-remote origin main`,
  released the lock.
- No `abandoned_commits` follow-up: hand-built directly, no
  `land_step_cli.bb` attempt was run.
- Scratch worktree `/tmp/land-bl1366` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1366`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
