# BL-1228 hardener pass — 2026-08-28

## Fixture leak fixed
`bl1228ActivePoolFreshnessHoldAuditSteps.js`'s `an empty backlog corpus`
Background step created a fixture root via `fs.mkdtempSync` with no cleanup
anywhere in the file — a pure leak on every scenario, pass or fail. Confirmed:
36 pre-existing `bl1228-backlog-*` dirs already in `/tmp` before this pass, and
a clean 9/9 acceptance run added 9 more, all green. Fixed with the standing
`registerFixtureRoot` + `process.on('exit')` + eager-Background-removal
pattern (BL-529/BL-971). Re-ran: 9/9 green, 0 leaked dirs.

## Mutation hardening (hand-authored — see Blocked below)
`extension/src/tools/active-pool-freshness-audit.ts`:
- `formatFinding` had no assertion on its own `ACTIVE-POOL-FRESHNESS-HOLD`
  marker literal — a mutant corrupting it survived. Added a dedicated test.
- `parseArgs` had zero test coverage. Added 4 tests (root given, no args,
  empty-string arg, extra args ignored) — a mutant flipping its `if (!root)`
  guard survived until these landed.
- `interpretFreshness` was CRAP 11 (complexity 11, 100% coverage — the
  complexity alone exceeded the gate). Extracted `isBlankRaw`,
  `resolveHoldReason`, `interpretParsedVerdict` — CRAP now 5/4/3/3 across the
  split. Behavior verified unchanged: the BL-897 oracle-parity test (compares
  every sample against `deprecate-check.ts`'s own `interpretFreshnessCliOutput`)
  still passes after the split.
- The `main()` handler (anonymous, CRAP 6.09 at 30% coverage — untestable
  in-process since it's the CLI's print loop) had its logic extracted into an
  exported pure `formatReport(findings)`, directly unit-tested for both
  branches (empty → clean message, non-empty → one line per finding). The
  handler itself is now a thin `for` loop, CRAP 2.75 (below threshold; the
  remaining uncovered fraction is CLI-entrypoint-only, same shape the
  CLI-entrypoint-CRAP-trap rule expects).
- Added 2 tests exercising `interpretFreshness`'s null/undefined branch
  (via `auditActivePool`'s injected `checkFreshness` seam, since the
  function itself isn't exported): production's own `checkFreshnessViaCli`
  never returns null/undefined (its TS type is `string`), but the branch is
  a deliberate BL-897 parity duplicate of `deprecate-check.ts`'s own
  `interpretFreshnessCliOutput`, whose `string | null | undefined` signature
  IS load-bearing there — narrowing the type here would break that parity
  contract, so I added coverage instead.
- One accepted equivalent mutant (BL-234): `interpretParsedVerdict(parsed) ??
  MALFORMED_VERDICT` vs `||` — `interpretParsedVerdict` returns only `null`
  or a `FreshnessDecision` object (never `0`/`''`/`false`/`NaN`), so `??` and
  `||` agree on every possible return value. Recorded in a code comment at
  the call site.

Hand-mutation sweep (both the original 11-mutant pass and a second pass after
the CRAP-driven refactor) covered: `interpretFreshness`'s three branches
(empty/malformed/decision-object), `isBlankRaw`'s three conditions,
`resolveHoldReason`'s type/length checks, `interpretParsedVerdict`'s
null-check/allow/hold branches, `auditActivePool`'s `!== 'allow'` predicate,
`listActiveTicketRefs`'s `.endsWith('.yaml')` filter and id-regex fallback,
`resolveDeprecateCheckCliPath`'s existence check, `checkFreshnessViaCli`'s
status check, `formatFinding`'s marker literal, `parseArgs`'s falsy guard,
and `formatReport`'s length check. All KILLED except the one recorded
equivalent above. Full unit suite for this module: 25/25 green.

CRAP: `node scripts/crapReport.js src/tools/active-pool-freshness-audit.ts`
— every function ≤6, exit 0 (previously 2 functions flagged: 11.00, 6.09).

## Blocked: full Stryker mutation run
`npx stryker run --mutate out/tools/active-pool-freshness-audit.js` requires
a green whole-suite Vitest dry run (perTest coverage analysis). This
worktree's full `npx vitest run` currently shows **37 failed test files, 16
failed tests** — none touching this ticket's files. Traced representative
failures to already-tracked, unowned pre-existing defects, not this ticket's:
- `startBridgeHeadlessCli.test.js`'s real-subprocess test needs a truthy
  `CURSOR_API_KEY` in the environment (this session had none) — environmental,
  not code (confirmed: setting any non-empty value fixes it; the CLI only
  checks presence, never validates a real key).
- `pilotAcceptanceGateCli.test.js` / `pilotMkdtempConventionCheck.test.js`
  fail because `assessPilotMkdtempConvention` resolves its detector through
  the SUBJECT root instead of the tool's own location — **BL-1209**
  (`backlog/paused/BL-1209-...yaml`), already filed.
- `docsStructureRealTree.test.js` fails the live-repo-derivation guard for
  the same class of reason — **BL-1212** (`backlog/paused/BL-1212-...yaml`),
  already filed.
- 25 of the 37 failed test FILES fail Vitest collection entirely
  (`No test suite found in file ...`) because they import `test` from
  `node:test` instead of using the Vitest global — **BL-1220**
  (`backlog/paused/BL-1220-...yaml`), already filed, exact match ("Twenty-five
  main-lane test files import test from node:test").
- The remaining named test failures (`backfillEpicTopicIconsCli`,
  `telegramClient`, `telegramCursorOperatorExec`, `operatorRuntimeBbFixtureClosure`,
  `constitutionDocCitations`, `backendSwitch`, `backlogDashboard`, plus the
  standing whole-tree guards `tempDirTrapGuard`/`tmpDirMigrationGuard`/
  `socketFixtureShortRootGuard`) are all in files this ticket never touched.

None of the above blocks are fixable within BL-1228's scope (out_of_scope
explicitly excludes changing anything but the audit itself), so per the
Hardening Order's tooling-unavailable fallback I ran a hand-authored mutation
sweep instead of the blocked Stryker pass (see above) — same posture as the
BL-638/no-wired-tool fallback, applied here because the tool IS wired but its
mandatory whole-suite precondition is blocked by unowned repo-wide red.

Confirmed my one NEW test-tree contribution
(`activePoolFreshnessAudit.test.js`'s real-CLI-subprocess test, which reads
the live repo root) does not add to the standing `liveRepoDerivationGuard`
violation count — added a `BL-1038-EXEMPT:` comment recording why (the whole
point of that test is exercising the real compiled CLI subprocess; cost is
fixed, not a function of repo size). Verified: before the exemption the guard
named `activePoolFreshnessAudit.test.js` among its 3 violators; after, only
the 2 pre-existing ones (`docsStructureRealTree.test.js`,
`pilotMkdtempConventionCheck.test.js`) remain.

## Cleanup
No orphaned test/mutation/tmux processes from this pass. `git status` clean
except the 3 files listed above. All hand-mutation probes reverted; verified
`git diff --quiet` on `src/tools/active-pool-freshness-audit.ts` before each
re-measurement and after the final one (only the intended refactor diff
remains).

By hardener.
