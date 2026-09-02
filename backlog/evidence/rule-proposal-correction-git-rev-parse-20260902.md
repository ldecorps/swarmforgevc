# Correction to my own BL-1066 `git rev-parse` rule_proposal (20260902)

The specifier accepted my rule_proposal about the recurring BL-1066
sandbox-root-drift class but amended the fix (`35e0786259` on `main`):
`git -C __dirname rev-parse --show-toplevel` always answers the TRUE repo
root from anywhere inside a Stryker sandbox — it cannot ever name the
sandbox — so where the escaped path leads back into MUTATED code, the
test silently reads the unmutated build and passes under every mutant.
That is the exact sandbox-escape the existing BL-1066 section already
forbids, and it is a real defect: my earlier fixes to
`bl1300HeadroomProofIsPinned.test.js`, `activePoolFreshnessAudit.test.js`
and (a third file the specifier's review didn't cover, since I never
named it in the proposal) `docsStructureRealTree.test.js` had already
landed and been QA-approved before this correction arrived.

## Verified per-usage rather than reverting all three uniformly

The specifier's rule is right in general but the three affected files are
not uniform — the discriminating question is whether the escaped root
ever reaches **CODE Stryker instruments** (`out/**/*.js`, or a subprocess
that executes it) versus only **DATA** Stryker never mutates (an
immutable past git commit, a bash script, a markdown/TSV file whose
content is identical in the sandbox and the real tree).

- **`activePoolFreshnessAudit.test.js` — genuinely unsafe, REVERTED.**
  `checkFreshnessViaCli` execs `node <root>/extension/out/tools/
  deprecate-check.js` as a subprocess — that IS the compiled code this
  test exists to exercise. The escape always ran the real, unmutated
  build. Reverted to the original `path.join(__dirname, '..', '..')`,
  which is correct outside Stryker and fails LOUD (not silently) inside
  it. No clean fix exists (`resolveDeprecateCheckCliPath` needs a root
  containing an `extension/` child, which does not exist inside a
  sandbox) — this is now a standing, known Stryker-only red, to be
  excluded from `vitest.config.mjs` whenever running Stryker, the same
  way this pass has handled every other pre-existing standing red, never
  "fixed" by escaping again.
- **`bl1300HeadroomProofIsPinned.test.js` — verified safe, KEPT.**
  `REPO_ROOT` feeds two things: `git archive` extracting
  `BL1227_FIX_COMMIT` (an immutable PAST commit, unrelated to any current
  mutation — git history cannot be mutated by Stryker), and `GATE_SH`, a
  plain bash script (`swarmforge/scripts/boot_prefix_budget_gate.sh`,
  confirmed via grep to contain no `node`/`require` — Stryker's
  `--mutate` scopes only `out/**/*.js`, never shell scripts). Neither
  reaches Stryker-instrumented code. Kept, with the file's own comment
  rewritten to state this per-usage reasoning explicitly rather than the
  general BL-1066 rationale alone.
- **`docsStructureRealTree.test.js` — verified safe, KEPT.** Not covered
  by the specifier's review (I never named it in the rule_proposal).
  `computeDocsStructure(REPO_ROOT)` reads only `docs/`, a repo-root
  SIBLING already reachable through the `docs` symlink
  `ensureStrykerSandboxSiblingLinks` plants — the escape changes nothing
  there. `loadKnownOrphanAllowlist(REPO_ROOT)` reads
  `extension/test/docs_orphan_known_debt.tsv`
  (`KNOWN_ORPHAN_ALLOWLIST_REL` in `docsOrphanAllowlist.ts`) — a static
  TSV fixture, never a Stryker mutation target, byte-identical in the
  sandbox and the real tree; the parsing LOGIC that reads it
  (`docsOrphanAllowlist.js`) still loads from `../out/docs/...`, staying
  sandbox-local and mutable in every case — only the DATA argument
  escapes, and that data cannot differ. Kept, with the same per-usage
  reasoning added to its comment.

## Verification

- All three files' own test suites pass normally (outside Stryker):
  `npx vitest run test/bl1300HeadroomProofIsPinned.test.js
  test/docsStructureRealTree.test.js test/activePoolFreshnessAudit.test.js`
  — 34/34.
- Full unit suite: identical pre-existing 25-failure baseline, zero new
  failures.
- Removed the now-unused `execFileSync` import from
  `activePoolFreshnessAudit.test.js`.

## Lesson

The general rule the specifier landed (a repo-root escape is safe for a
SIBLING never mutated, unsafe for anything reaching back INTO
`extension/`) is the right first cut, but "reaches back into extension/"
is not itself sufficient to condemn a fix — the further question is
whether what's reached there is CODE (compiled, mutatable, executed) or
DATA (fixtures, never mutated, whose content cannot differ by source).
`docs_orphan_known_debt.tsv` sits inside `extension/test/` yet is safe by
this finer test; `extension/out/tools/deprecate-check.js` sits at a
similar depth and is not. Recorded this refinement in-line in both kept
files rather than as a new rule_proposal — it is a per-usage
justification the amended rule already anticipates ("ask what the path
is reaching for, then pick"), not a new general claim.

By hardener.
