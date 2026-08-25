# telegram-board-nbsp-reapply — hardener pass (bounce re-fix), 2026-08-24

## Inbound

Merged architect `d7cbdf5a3c` (on cleaner batch tip including coder restore
`a966f07948` + bounce clear `39435d8721`) into `swarmforge-hardender` as
`31e1e55a20`.

Restore-only parcel: re-align stamped board/feature/docs narrative with
certified `&nbsp;` HOTFIX_PATHS. No new production module.

## Bounce clearance

| Item | Check | Result |
|---|---|---|
| Architect D1 | Spec `escapeHtml` named-entity wording | `&nbsp;` (no `&#160;`) |
| Architect D2 | done YAML narrative / vitest claim | `&nbsp;` (no `&#160;`) |
| QA D1 | Feature Then-line + BL-1113 board Outline | 9/9 green |
| QA D2 | `pipelineBoard.ts` == `27273f2b0a`; properties 2/2 | OK |
| Pack | `cursor-forge.conf` == `27273f2b0a` | MATCH |
| HOTFIX_PATHS | all six paths `git diff --quiet 27273f2b0a` | OK |
| Dep-gate | `pipelineBoard.ts` + board unit | PASSED |
| Board unit | `pipelineBoard.test.js` | 127/127 |

## BL-149 / Stryker

`pipelineBoard.ts`: **skip-cooldown** (age 0.02d < 3d). Host quiet
(~1.8 load / 20 cores). No Stryker this pass — recent-touch bypass;
targeted tests + surgical instead. Full mutation deferred to a quiet later
pass on the stamped surface if needed.

## CRAP / differential

`crapReport.js src/concierge/pipelineBoard.ts`:
- **`escapeHtml`** (parcel seam): complexity=1, coverage=100%, **CRAP=1.00**
- `deriveKebabSlug` / `wrapPipelineBoardHtml` / `padStartNbsp`: CRAP ≤ 2.00
- Other CRAP>6 functions in the file are pre-existing / grandfathered;
  tip does not touch them (blob identity with `27273f2b0a`).

## Soft gates

- BL-1113 acceptance 9/9; properties 2/2
- Standing whole-tree guards: 13 files / 125 tests pass
- `dependency-gate` PASSED

## Hand-authored surgical (`escapeHtml` NBSP entity)

| Mutant | Result |
|---|---|
| `&nbsp;` → `&#160;` | killed (BL-1113 acceptance) |
| NBSP replace → empty string | killed |
| Drop NBSP replace line | killed |

Survivors: 0.

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`telegram-board-nbsp-reapply`.

By hardender.
