# BL-1010 hardener pass — 2026-08-22

**Parcel:** architect forward `f21ce2be5f` (evidence-only commit; the real
diff is the coder's own `5a2c2524c`), merged into hardender at `bfe8486bd`'s
successor. Architect reviewed clean, no defect found, forwarded as-is.

**Verdict: hardened. Two real mutation gaps closed with tests, plus one CRAP
regression fixed with a behavior-preserving split.** No mutation/CRAP/DRY
tooling gap encountered on the TS side; the `.bb` side has no wired mutation
tool (per engineering.prompt), so its coverage gap was closed with a
hand-authored surgical mutation sweep (BL-567 pattern).

## Host load — office-hours bypass invoked

`uptime` read 12–23 (avg) on 4 cores at pass start, already over the 2x-cores
threshold, then spiked to load average 100+ mid-pass from other roles'
concurrent test runs (confirmed via `pgrep` — architect's and coder's own
`node --test`/vitest processes, not mine, nothing of mine left running).
Per the office-hours bypass and the "binds every mutation runner" rule: no
Stryker run and no BL-113 Gherkin mutation run were attempted this pass —
deferred to the next quiet pass. This is the first deferral for this ticket
(not a repeat stall), so no defect ticket is warranted per the "escalate on
the second one" rule. Everything else below is hand-verified mutation and
full targeted-suite re-runs, which are cheap enough to run regardless of load.

## Mutation gaps found and closed (hand-authored, non-vacuity proven by hand)

1. **`readSwarmIdentityValue` (now split, see below): an identity line with
   an EMPTY `swarm_name` value was uncovered.** The code already had the
   guard ("An empty value is not a name - fall through..."), but no test
   exercised it. Added
   `extension/test/bl1010SwarmNameResolution.test.js`'s new "an identity
   file with an empty swarm_name value falls through" test. Verified by
   hand: deleting the `if (value) return value;` guard (mutant: unconditional
   `return value;`) made the test fail (`expected 'third', got ''`);
   restored, byte-diffed clean, re-confirmed 9/9 green.

2. **The `tab < 0` guard on a malformed (no-tab) identity line was
   uncovered by an unrelated fixture.** My first attempt at this test used a
   tabless line ("swarm_name_with_no_tab") that happened NOT to discriminate
   the mutant — with the guard deleted, `line.slice(0, -1)` (indexOf's `-1`
   sentinel used as a slice bound) still didn't equal the bare key for that
   fixture, so the mutant survived silently under the first fixture I wrote.
   Caught by re-running the mutant against the new test before trusting it
   (this pass's own rule): the DISCRIMINATING fixture is a tabless line
   exactly one character longer than the key itself — `"swarm_nameZ"` — for
   which `line.slice(0, -1) === "swarm_name"` is TRUE, so a guard-dropped
   mutant misreads it as a match with value `"swarm_nameZ"`. Rewrote the test
   to use that fixture; confirmed it fails hard against the mutant
   (`expected 'third', got 'swarm_nameZ'`) and passes against the real code.
   Restored, byte-diffed clean, re-confirmed 9/9 green.

3. **`node-tool-bringup-lib/names-bring-up-step?` is an `and` of two
   substring checks (command, dir); the existing tests only exercised
   "has neither" and "has both".** A mutant dropping either single clause
   survived both existing tests. Added two discriminating cases to
   `node_tool_bringup_lib_test_runner.bb`: a message naming the command but
   not the directory, and one naming the directory but not the command — both
   must stay rejected. Verified by hand: dropping the dir-clause from the
   `and` made the "command without directory" test fail
   (`expected false, got true`); dropping the command-clause made BOTH the
   original bare-module-not-found test AND the new "directory without
   command" test fail (the bare module-not-found message's own path contains
   `extension/`, so it now falsely passed too). Restored both times, byte-diffed
   clean, re-confirmed `ALL PASS` both runs.

4. **`missing-tool-message` dropping the absent `cli-path` from its own
   message was uncovered** — no test asserted the specific path appears,
   only that the tool name/command/dir do. Added an assertion for the literal
   path in the existing message test. Verified by hand: removing the
   `" (" cli-path " does not exist)"` clause from the `str` still passed
   every other assertion; the new one failed
   (`expected true, got false`). Restored, byte-diffed clean, re-confirmed
   `ALL PASS`.

## Non-gap, checked and ruled equivalent

`return value || undefined` in the extracted `parseIdentityLine` (see below)
vs. bare `return value`: hand-mutated to drop the `|| undefined`, ran the
full suite — all 9/9 still passed. Not a real gap: the caller
(`readSwarmIdentityValue`) already re-checks `if (value) return value;`
before ever returning, so an empty-string return from the helper is filtered
identically to `undefined` at the only call site. No test added for this
line specifically — the empty-value behavior is already covered end-to-end by
gap (1) above, at the point where it is actually observable.

## CRAP regression found and fixed (behavior-preserving split, hardener's own domain)

`node scripts/crapReport.js src/bridge/holisticProjections.ts` against a
coverage run scoped to the two test files that exercise this module
(`bl1010SwarmNameResolution.test.js`, `holisticProjections.test.js` — not the
full suite, given host load) reported:

    readSwarmIdentityValue  complexity=7  coverage=100%  CRAP=7.00  *** CRAP > 6 ***

100% coverage, so this was a pure complexity problem, not a coverage gap —
the per-line parse (blank-line skip, tab-index guard, key-match, empty-value
guard) was inlined into the same function as the file-read try/catch and the
scan loop, stacking six branches onto one function.

Extracted the per-line parse into its own pure `parseIdentityLine(line, key)`
helper — the same "extract to isolate CRAP" pattern the specifier's own
accepted rule_proposal already prescribes for `bridgeServer.ts` dispatchers.
Re-ran crapReport after the split:

    parseIdentityLine        complexity=5  coverage=100%  CRAP=5.00
    readSwarmIdentityValue   complexity=4  coverage=100%  CRAP=4.00

Both under the threshold; `node scripts/crapReport.js` now exits 0 for this
file. Behavior-preserving: re-ran the full mutation-gap re-verification (all
four points above) against the split code, all four mutants still killed at
their new locations, and the full targeted test/property/acceptance re-run
below is against the split code, not the pre-split version.

## DRY

`npx jscpd --config .jscpd.json src/bridge/holisticProjections.ts` (scoped,
not the full `src/` tree given host load): 0 clones, 0% duplication.

## Dependency gate and standing whole-tree guards

- `node extension/out/tools/dependency-gate.js src/bridge/holisticProjections.ts`
  (from repo root) → PASSED, no forbidden edges. Unchanged from the
  architect's own run.
- Parcel touches `specs/pipeline/steps/` (new step file) and `extension/test/`
  (new/edited test files), so per the standing whole-tree-guard rule, ran
  every guard test file (11 as of today, up from the 6 recorded
  2026-08-19 — `ls extension/test/*Guard*.test.js`, excluding `.property.`
  siblings): 9/11 files clean. The 2 failing —
  `tempDirTrapGuard.test.js` (flagging
  `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`) and
  `tmuxReaperGuard.test.js` (flagging
  `specs/pipeline/steps/bl1018SingleRoleRepairNeverKillsServerSteps.js`) —
  are PRE-EXISTING and NOT this parcel's: both flagged files are outside this
  parcel's changed-file set (confirmed via `git diff --stat` against the
  merge-base), both already documented as pre-existing by the coder's own
  commit message and re-confirmed as untouched by the architect's evidence
  file (its "What was NOT re-litigated" section). Not re-litigated again
  here; the coder already routed a note for them rather than folding an
  unrelated fix into this ticket.

## Verification re-run live (against the post-split code, not trusted from the commit message)

- `npm run compile` (from `extension/`) → clean.
- `npx vitest run test/bl1010SwarmNameResolution.test.js` → **9/9** (was 7/7;
  +2 new hardening tests).
- `npx vitest run test/holisticProjections.test.js` → **22/22** unaffected by
  the split.
- `npx vitest run test/tmpDirMigrationGuard.test.js` → **11/11**, still green.
- `npx vitest run --config vitest.properties.config.mjs test/bl1010SwarmNameResolution.property.test.js`
  → **3/3**.
- `bb swarmforge/scripts/test/node_tool_bringup_lib_test_runner.bb` →
  `ALL PASS` (was already-passing 3 assertions; +2 new hardening cases).
- `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` →
  still `ALL PASS`, BL-1022 closure unchanged (54 files).
- `node specs/pipeline/cli.js specs/features/BL-1010-a-secondary-swarm-publishes-under-its-own-name.feature`
  → **7/7** (all scenarios, including the Outline's four rows) — re-run
  against the post-split, post-hardening code.

## What was NOT run this pass, and why

- Stryker (not applicable — `holisticProjections.ts` is not in
  `stryker.config.json`'s `--mutate` scope and this pass used hand-authored
  mutation instead, per the small/localized nature of the change).
- BL-113 Gherkin mutation for Scenario Outline `secondary-swarm-name-01` (4
  Examples rows) — deferred to the next quiet host pass per the office-hours
  bypass; see load evidence above. First deferral for this ticket.
- Full-suite `npm run coverage`/`npm run crap` — ran targeted instead
  (`--coverage` scoped to the two files exercising this module) to avoid an
  8000+-test full run under contended load; the file's own CRAP figures are
  unaffected by which other files' tests also ran.

— By hardener.
