# BL-1430 — architect pass, 2026-09-05

Ticket: BL-1430-the-portable-time-guard-has-one-definition
Role: architect
Commit reviewed: 4cf92d6288 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1430PortableTimeGuardSingleDefinitionSteps.js`)
  and full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in
  both. The change is test-file scoping fixes (`EXCLUDED_DIR_NAMES`
  additions), one allowlist/register bookkeeping cleanup, and one step
  handler — no webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: only pre-existing sibling coupling (BL-874's own
  guard family) — nothing new or suspicious.

## Sole invariant, verified by hand

"The portable-time guard keeps one definition and every caller reaches
it... never relaxes the property's assertion." Confirmed the assertion
text in `bl874PortableTimeInvariants.property.test.js` is byte-identical
before and after (only `EXCLUDED_DIR_NAMES` gained `.worktrees`) — the fix
is entirely a walk-scope correction, never a weakened check. Root cause
confirmed independently: `git grep -l 'function findPortableTimeViolation'
-- extension/src specs/pipeline` returns exactly one file
(`specs/pipeline/steps/lib/portableTimeGuard.js`), while the property's
own unscoped walk was counting the same file's copy inside every
`.worktrees/<role>/` linked checkout — a host-population artifact, not a
real duplication, exactly as the ticket diagnosed.

## Collateral fixes in the same parcel — correctly scoped, not scope-creep

1. **`tempDirTrapGuard.property.test.js`** got the identical `.worktrees`
   exclusion — the ticket's own direction said to check siblings for the
   same hole "in the same parcel." Confirmed this file's own
   `findFunctionDefinitionFiles` walk had the identical gap.
2. **`bl1175PropertySuiteStandingRedsInvariants.property.test.js`**'s
   `inventory.length >= 20` floor was loosened to `> 0` — a hardcoded
   count that this very ticket's own allowlist trim (20→18 rows) would
   otherwise turn into a NEW standing red the moment it landed. The
   structural checks (per-row shape, disposition, rationale) are
   unchanged; only the "not silently empty" floor was relaxed to accept a
   number that legitimately shrinks over time. This is the right call —
   not a weakening of THIS ticket's own invariant (which concerns the
   portable-time guard specifically), and well-reasoned in-line.
3. **A coder-self-caught bug**: scenario 01's own git-grep pattern was
   initially written as a contiguous string inside the step handler file
   itself (which lives under `specs/pipeline`, one of the two scanned
   trees) — invisible to `git grep` while untracked, but self-matching
   once committed. Caught by the coder's own post-commit merge re-verify,
   fixed by string concatenation (mirroring
   `bl948SocketFixtureShortRootSteps.js`'s existing precedent for the same
   trap). I independently ran the real `git grep` command from the step
   handler (not a reimplementation) and confirmed it returns exactly 1
   file with the tracked, concatenated version.

## Independently re-verified the substance

- `npx vitest run --config vitest.properties.config.mjs
  test/bl874PortableTimeInvariants.property.test.js
  test/tempDirTrapGuard.property.test.js
  test/bl1175PropertySuiteStandingRedsInvariants.property.test.js` →
  3 files, 18 tests, all pass — the standing red is now green, confirmed
  directly.
- `git diff` on `property_suite_standing_allowlist.tsv` and
  `backlog/standing-reds.tsv` → both the bl874 row AND the (already-fixed
  by BL-1289, but not yet bookkept) tempDirTrapGuard row removed —
  correct cleanup per BL-1428's own convention, matching qa_e2e item 3
  exactly.

## Acceptance wiring

Feature declares 2 scenarios / 2 scenario runs. Independently drove
`bl1430PortableTimeGuardSingleDefinitionSteps.js::registerSteps` against
both — passed, including scenario 01's real `git grep` (not a
reimplementation) confirming exactly one tracked definition.
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
