# Pane-title chrome covers every producible role name (BL-732)

BL-642 strips the tmux pane-title rule (`──── SwarmForge Coder ──`) from
NeedsApproval / topic snippets so letters in the session name do not defeat
the whole-line box test. Its matcher was a **single token**
(`/^SwarmForge [A-Za-z][\w-]*$/`).

The launcher builds titles as `SwarmForge ${DISPLAY_NAMES[$i]}` via
`display_name_for_role` (`swarmforge.sh`), which:

- rewrites `-` and `_` to spaces and title-cases each word → `model-steward`
  becomes `Model Steward`
- leaves `@` as a separator of alphanumeric runs → `coder@sonnet2` becomes
  `Coder@Sonnet2`

Those shapes missed the single-token regex, so multi-word and `@`-seat title
rules leaked into the human-facing question text.

## Fix

`needsHumanDetection.ts` derives the recognized session-name pattern from the
same contract (`displayNameForRole` / `isLauncherPaneSessionName`) — never a
hand-extended character class that will drift when the launcher learns a new
separator.

Covered examples: `coder`, `QA`, `model-steward`, `coder_extra`,
`coder@sonnet2`, `hardender@zz9`. A box-rule line with real question text is
still kept; a pane of nothing but chrome still fail-closes to
`(no question text captured; open the pane)`.

## Related

- [BL-642: gate snippet shows the question, not terminal chrome](BL-642-gate-snippet-question-not-chrome.md)

Acceptance:
`specs/features/BL-732-pane-title-chrome-covers-every-producible-role-name.feature`
