# BL-1184 — hardener pass — 20260827

## Inbound

Architect `c5e8ffb3b9` after cleaner DRY (`briefingChartSvgCommon`).

## Host / cooldown

All new production files reported **run**. Load ~4–6 on 20 cores (quiet).
Full-suite Stryker dry-run blocked by standing unit reds — used scoped
vitest include (`test/shiftVelocity.test.js`) for differential mutation.

## Gates

| Gate | Result |
|---|---|
| Unit `shiftVelocity.test.js` | **17/17** |
| Properties `bl1184…Invariants.property.test.js` | **3/3** |
| Acceptance BL-1184 feature | **6/6** |
| Soft Gherkin | **4/4 killed** (first soft run); soft re-run stamped skip (BL-460) |
| Scoped Stryker (shiftVelocity, chart, telemetry, svgCommon) | see below |
| CRAP (parcel src + burndown co-coverage) | **≤ 6** all changed functions |
| DRY | no new clones on parcel paths |

## Mutation

| File | Score | Notes |
|---|---|---|
| `briefingChartSvgCommon.js` | **100%** | |
| `shiftVelocity.js` | **88%** | 4 survivors: equivalent max/`>=`, empty-series Math.min short-circuit, `Date.parse(null)`≡NaN |
| `shiftVelocityTelemetryStore.js` | **90%** | blank-line trim vs empty-line equivalents |
| `shiftVelocityChart.js` | **47%** | remaining survivors are SVG presentation literals / layout arithmetic; load-bearing `nonLinearTimeX` / spacing covered |

## Hardening

- Killer unit coverage for window edges, telemetry ledger regex, XML escape,
  nice-axis arms, render CLI via lifecycle snapshot.
- `nonLinearTimeX`: floor maxAge at 1 so single-day series stays finite.
- `parseRecord`: extract `isTelemetryRecordShape` (CRAP ≤ 6).

## Worktree recovery note

Before this pass could be committed, `swarmforge-hardender`'s branch ref had
been carried 45 commits past the real merge (`da8ef009a`, "merge_and_process
architect c5e8ffb3b9 for BL-1184") by an unrelated `init`/`seed`/`fixture:
initial`/"BUG: bare commit bypassing commit_integrity_cli" commit chain — a
test/fixture harness ran `git init`/`git commit` cycles directly against this
live worktree instead of an isolated fixture root, reducing the branch tip's
tree to just `src/` and `swarmforge/`. Working-tree files were untouched
(this hardening pass's real edits and this evidence file were still present
on disk). Recovered with `git reset da8ef009a` (mixed reset only — moved
HEAD/index back to the real merge commit, touched no working-directory
content; the 45 junk commits remain reachable via reflog).

That same contamination had also left two files with an unrelated,
unexplained regression sitting in the working tree: `swarmforge/scripts/
handoffd.bb` and `swarmforge/scripts/briefing_email_lib.bb` had the
shift-velocity briefing-email wiring (`briefing-shift-velocity-json`,
`diagram-section-from-sources`'s third arg, `has-shift?` diagram-heading
cases) *removed* — directly contradicting this ticket's own
`required_wiring` line ("briefing burndown/email path::shift velocity
chart::non-linear time axis") and never mentioned by any pass's evidence
file. Discarded back to `da8ef009a`'s version
(`git checkout da8ef009a -- <path>` for both files) rather than committed;
verified the wiring is restored (`briefing-shift-velocity-json` present in
both files again).

Post-recovery re-verification (this session): `npm run compile` clean;
`vitest run test/shiftVelocity.test.js` 17/17; `vitest run --config
vitest.properties.config.mjs test/bl1184BriefingShiftVelocityInvariants.property.test.js`
3/3; `run_acceptance.sh specs/features/BL-1184-briefing-shift-velocity.feature`
6/6; `crapReport.js` on both touched src files — all functions CRAP ≤ 6
(max 6.00). All match this file's originally recorded results.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1184-briefing-shift-velocity`.

By hardender.
