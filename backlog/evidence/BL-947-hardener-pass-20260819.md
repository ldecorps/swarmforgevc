# BL-947 hardener pass — 2026-08-19

## Reviewed commit
`6716a8fc3c` ("BL-947: architect pass - dependency gate clean, invariants
verified, forwarding to hardener"), merged into hardener as this parcel.
No bounce.

## Scope, precisely
`git diff 25bd0fe8b^ 25bd0fe8b` — BL-947's own 7 files: the two new
`extension/test/` files (property test + standing whole-script guard),
the new acceptance step handler, `index.js`'s registry line, the new
pure `swarmforgeShErrorChannel.js`, `swarmforge.sh` itself (all 27 sites
routed through one `error_msg()` helper), and the fork-deviation record
in `docs/upstream-deviations.md`. (`extension/src/tools/vitest-worker-
memory-budget.ts` and the vitest config changes visible in the wider
merge belong to sibling ticket BL-935, still architect-bounced and
unfixed — not this parcel's scope, not reviewed here.)

## Tooling scope check
No `extension/src/*.ts` touched by this parcel. Stryker/CRAP/DRY
inapplicable. `swarmforgeShErrorChannel.js` lives under
`specs/pipeline/steps/lib/`; `swarmforge.sh` is bash — neither has a
mutation/CRAP/DRY tool wired at this boundary.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load 17–21 on 4 cores (down
   sharply from earlier this session's 160+ peak). All changed files
   skip-busy/skip-cooldown; no formal mutation tooling applies regardless.
2. **Applied the standing-guard rule from this session's own rule_proposal
   (accepted by specifier, widened to all 6 guards) for real, not just in
   principle**: before trusting only this parcel's own new tests, checked
   whether the new step handler's fixture (`mkTmp()`, `/tmp`-rooted) or
   the new `.property.test.js` file could trip either of the two
   whole-tree guards that caught real BL-631/BL-945 defects earlier
   today — `tmuxReaperGuard.test.js` (scoped to `specs/pipeline/steps/`,
   requires a quoted `'new-session'`: grepped the new step handler, zero
   matches — it drives the launcher only up to its refusal point, before
   any tmux session would start) and `tmpDirMigrationGuard.test.js`
   (scoped to `extension/test/` only: the new step handler's raw
   `fs.mkdtempSync` lives under `specs/pipeline/steps/`, outside that
   guard's scan root, and is explicitly, deliberately `/tmp`-rooted
   rather than `os.tmpdir()`-rooted — the file's own comment explains
   why: avoiding the exact over-limit-socket-path trap BL-944's
   regression testing hit, the same class BL-948 exists to fix
   elsewhere). Ran both guards anyway rather than reasoning from grep
   alone: `npx vitest run test/tmuxReaperGuard.test.js
   test/tmpDirMigrationGuard.test.js
   test/swarmforgeShErrorChannelGuard.test.js` — **24/24 PASS**, zero
   violations in the real tree (confirms BL-631's own QA-bounced
   `fixtureReaper` gap is now fixed and merged in via this session's
   earlier QA broadcasts).
3. **Independent re-run of the new property test**: `npx vitest run
   --config vitest.properties.config.mjs
   test/swarmforgeShErrorChannel.property.test.js` — **4/4 pass**.
4. **Acceptance, independently re-run**: this ticket's own feature —
   **4/4 PASS**, matching the architect's report.
5. **Own correctness spot-check of the fix itself** (beyond re-running
   suites): `grep 'echo -e "${RED}Error:${RESET}' swarmforge/scripts/
   swarmforge.sh | grep -v '>&2'` — **zero** raw stdout error echoes
   remain (all 27 sites route through `error_msg()`, which itself writes
   `>&2`). Read the socket branch directly (`swarmforge.sh:136-138`):
   the `2>&1` capture into `$TMUX_SOCKET` is untouched (still needed to
   capture the bb diagnostic into a variable, per the ticket's explicit
   constraint), and only the re-emission (`error_msg "$TMUX_SOCKET"`)
   changed channel — exactly the fix the ticket asked for, not a removal
   of the capture.
6. **Fork-deviation record** confirmed present and correctly shaped
   (`docs/upstream-deviations.md`, dated entry naming the change and
   rationale, per Architecture Rule 2's constraint requirement).
7. **Leak/process check**: 0 leaked `bl947`-prefixed fixture dirs in
   either `/tmp` or `$TMPDIR`; `git status --short` clean.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. Both standing
whole-tree guards this session's own rule_proposal named (plus the
ticket's own new whole-script guard) independently re-run and confirmed
clean against the real tree — the first real application of that rule
since it was accepted. Property test, acceptance feature, and the fix's
own mechanical correctness (zero remaining stdout error echoes, the
deliberately-preserved `2>&1` capture) independently re-verified.

Forwarding to documenter.

By hardener.
