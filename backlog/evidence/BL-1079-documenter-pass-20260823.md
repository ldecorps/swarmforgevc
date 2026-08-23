# BL-1079-a-cursor-identity-can-be-steward-certified — documenter pass — 20260823

Cursor thin-pass (Claude seats weekly-capped until 2026-08-27).

Commit received: `5e0b346dba` (hardener PASS — surgical bb mutation 5/5 killed;
BL-113 Gherkin deferred under BL-149 cooldown). Merged as `49aee3e34`
(conflict only in `specs/pipeline/steps/index.js`: keep BL-1071 + BL-1078 +
BL-1079 requires). Also cleared a stuck BL-1078 QA merge-up (`28e78f38c`) before claiming this
parcel. Pre-QA ancestry initially refused the forward: original coder baby-step
SHAs (`05bf3dc776`…`0436e720c6`) were cherry-picked onto cleaner under the
Claude weekly cap and are not ancestors of this tip; declared them under
`abandoned_commits` (flow style) on the ticket YAML — content is present via
the cherry-pick SHAs already in lineage.

## What the parcel already carried (cleaner)

Primary how-to
`docs/how-to/BL-1079-cursor-identity-steward-certify-and-residuals.md`:
operator certify path for `cursor/auto`, scorecard refuse/present contract,
routing after certify, plus residuals (bootstrap limits, no Claude `/rc` for
Cursor seats, cost attribution under provider `cursor`). Cross-links already
in BL-547, BL-514, BL-713 boundary, and `docs/index.md`.

## Doc surfaces this pass

- **Stale claim in BL-713** "The certification gate": still said registration
  and certification "are BL-712 slice C, deliberately not folded in here".
  Rewrote to state BL-1079 landed the seed + scorecard-backed certify, and
  that this spike deliberately still runs *uncertified* behind its escape.
  Boundary section was already correct.
- **`docs/index.md`**: BL-713 blurb now says "landed steward certification
  (BL-1079)" rather than implying it was still pending beside the launcher.
- **BL-525 ModelFactory how-to**: added a bullet under Integration with Model
  Steward pointing at the Cursor certify how-to (provider `cursor`, never a
  borrowed Anthropic id).
- Grepped `docs/` for `still-to-come` / pre-land claims about BL-1079: no
  remaining false "not built" claims. Diagrams do not name steward identities
  or agent tokens; no diagram change. README unchanged (no new extension
  command surface).
- No new Divio mode invented — the parcel's how-to already covers the
  operator path; residuals stay in that same how-to rather than a separate
  explanation page.

## Verification

`run_acceptance.sh` BL-1079 feature — **5/5** (after `npm run compile` for
a stale `extension/out` on this worktree; not a docs defect).

## Forward

Forwarding to QA, priority 00.

By documenter (Cursor thin-pass).
