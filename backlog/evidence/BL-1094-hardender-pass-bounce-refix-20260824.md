# BL-1094 — hardener pass (QA bounce re-fix), 2026-08-24

## Inbound

Merged architect `3d87948adf` (on cleaner `ede9e208a7` / coder hitchhiker
strip `a1a2feb5b3`) into `swarmforge-hardender`. Prior harden tip
`5daa51c1ab` remains in lineage; this pass re-verifies bounce clearance
D1–D3 and re-checks the exemption seam.

## Bounce clearance (D1–D3)

| Item | Check | Result |
|---|---|---|
| D1 | `cursor-forge.conf` `git diff --quiet 27273f2b0a`; BL-1113 pack scenario | OK |
| D2 | `pipelineBoard.ts` matches stamped `&nbsp;`; BL-1113 board Outline | OK |
| D3 | HOTFIX_PATHS property 2/2; six-path blob identity | OK |
| hitchhiker | `cursor-forge.prompt` absent | OK |

## BL-149 / Stryker

`pipelineBoard.ts`: **skip-cooldown** (age 0.03d < 3d). Host quiet
(~2.1 load / 20 cores). No Stryker this pass — office-hours/recent-touch
bypass; targeted tests + surgical instead. Full mutation deferred to a
quiet later pass on the stamped surface if needed.

## CRAP / differential

Targeted coverage + `crapReport.js src/concierge/pipelineBoard.ts`:
- **`escapeHtml`** (only function this strip intentionally changes):
  complexity=1, coverage=100%, **CRAP=1.00**
- `deriveKebabSlug` / `wrapPipelineBoardHtml`: CRAP 2.00 — clean
- Other CRAP>6 functions in the file are pre-existing / grandfathered;
  strip does not touch them (diff vs `27273f2b0a` is the NBSP entity line
  + comment only). No differential complexity regression on the changed
  function.

## Soft gates re-run

- Coherence unit ALL PASS (incl. handoffd `DISPATCH_GAP` wiring assert)
- BL-1094 acceptance 5/5; properties 2/2
- BL-1113 acceptance 9/9; properties 2/2
- `dispatchGapSteps.test.js` 18/18; `pipelineBoard.test.js` 127/127
- Standing whole-tree guards 125/125

## Hand-authored surgical (re-arm after refix)

| Mutant | Result |
|---|---|
| Remove handoffd `DISPATCH_GAP` env assoc | killed (unit wiring) |
| `check-enabled?` always true | killed (unit) |
| `escapeHtml` `&nbsp;` → `&#160;` | killed (BL-1113 acceptance) |

Survivors: 0. Prior Gherkin/surgical on the exemption lib from the first
harden pass remains load-bearing; bounce tip did not change that code.

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`.

By hardender.
