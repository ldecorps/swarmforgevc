# BL-1428 — hardener pass, 2026-09-05

Ticket: BL-1428-every-standing-red-names-an-open-owner
Commit reviewed: 0ceb4d5df8 (cleaner) / daeaf98e56 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (8/8 killed)

This adds a NEW commit guard (`check_standing_red_register.sh`) to
`run_commit_guards.sh`'s Tier 1 — a live path every future commit,
including this hardening pass's own, goes through. Reviewed with the same
care given to BL-1411 (another live-send-path change) earlier this
session.

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/standing_red_register_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/bl1428_every_standing_red_names_an_open_owner_property_runner.bb` | ALL PROPERTIES HOLD, 200/200 each of P1/P2, coverage `{:p1-has-covered 138, :p1-has-orphan-allowlist 139, :p1-has-orphan-ledger 140, :p2-touches-register 101, :p2-does-not-touch 99, :p2-staged-ok 51, :p2-staged-bad 50, :p2-has-stale-rows 153}` |
| `node specs/pipeline/cli.js specs/features/BL-1428-...feature` | 7/7 scenario runs |
| `bash test_run_commit_guards.sh` (regression, the guard chain itself) | 12/12 PASS |
| `npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js` (regression) | 5/5 PASS |
| `bash test_property_suite_drift_guard.sh` (regression) | 6/7 — scenario 07 is the already-known, already-owned (BL-1409) pre-existing red confirmed by this session's own earlier BL-1407 hardening pass |
| `bb standing_red_register_cli.bb .` (live) | `count: 32, oldest_age_days: 17`, 5 unowned rows — matches the coder's/architect's/cleaner's own reported finding exactly (all 5 are stale `hardening`-lane ledger entries for BL-620/955/954/956×2, whose owning tickets have all since landed; BL-942's drain scope, not this ticket's) |
| `grep -c allowlist property_suite_standing_allowlist.tsv` | 20 (the 5 green rows removed, invariant 3) |
| `grep -n check_standing_red_register.sh run_commit_guards.sh` | Tier 1 (required_wiring) |
| `bl1428StandingRedRegisterSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 4 examples, 2 columns each)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1428-every-standing-red-names-an-open-owner.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **8 mutants, 8
killed, 0 survived** (both `<ticket>` and `<verdict>` cells across all 4
Examples rows, single-letter case/character flips) — clean. Manifest
stamp committed alongside this evidence.

## Read the guard script directly for edge cases

Read `check_standing_red_register.sh` end to end (not only the property
tests' coverage). Confirmed:

- The guard's three judged source paths (`backlog/standing-reds.tsv`,
  `swarmforge/scripts/property_suite_standing_allowlist.tsv`,
  `backlog/hardening-debt-ledger.yaml`) are exactly the three this ticket
  names — **none of the evidence files or mutation-manifest stamps this
  hardening pass itself commits touch any of them**, so this new guard is
  a no-op for every commit this session has made or will make.
- `tsv_fields_01`'s `\x01`-rejoin sidesteps the documented `read`-with-TAB-IFS
  pitfall (a genuinely empty ticket column silently shifting later fields)
  — traced the awk `-F'\t' -v OFS=$'\x01'` transform by hand and confirmed
  it preserves empty fields correctly, unlike a bare `IFS=$'\t' read`.
- The allowlist branch's `normalized="extension/$normalized"` prefixing
  (when the staged allowlist path doesn't already start with `extension/`)
  matches the register's own `lane="property"` rows, which are always
  fully `extension/...`-qualified — confirmed by reading a live register
  row's `file` column.
- Fail-open scope is narrow and deliberate: only an unresolvable repo root
  triggers the WARN-and-exit-0 path; the guard's OWN refusal logic never
  fails open on a genuine violation, matching the header comment's stated
  rationale ("this guard's OWN refusal requires being SURE, not merely
  suspicious").

No gap found. The property tests' real-git-fixture coverage (P2 builds
actual staged commits and drives the real guard subprocess) already
proves the mechanics this manual read confirms by inspection.

## Design/CRAP/DRY

No production code changed by this pass. Shell/Babashka have no
mutation/CRAP/DRY tooling wired (BL-472 deferred, cleaner already
confirmed `jscpd` finds 0 clones on the shell guard); gated by the
unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
