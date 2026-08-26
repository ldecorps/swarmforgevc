# /pilot reinjects each live role prompt at hat change (BL-758)

## Rule

At each hat change and bounce-back, reinject `composePilotStagePrompt(ticket, role)`:
thin pilot isolation wrapper **plus** the full live `swarmforge/roles/<role>.prompt`
bytes (QA → `QA.prompt`), plus pack overlay when configured. Do not wear every
hat from one mega-brief alone.

Each `NN-<role>/verdict.json` must record `role_prompt_path` and
`role_prompt_sha256` (64-hex). Land refuses `reasonKind: pilot-hat-prompt-missing`
when either is absent. Telegram hat status (BL-700) is not sufficient evidence
alone.

## Surfaces

| Surface | Location |
| --- | --- |
| Stage composer | `composePilotStagePrompt` |
| Start brief | `composePilotExpeditorPrompt` (PER-HAT REINJECT) |
| Land gate | `checkPerHatRolePromptEvidence` → `reasonKind: pilot-hat-prompt-missing` |

## Land-gate semantics

- Scope: every completed stage verdict under the run's expedite tree.
- Fail open with warning when the expedite tree cannot be read.
- Refused land is inert (no yaml move, no receipt).
- Clean land records `perHatRolePromptEvidence.verdictsScanned` on the
  acceptance receipt.

Full gate narrative:
[BL-727 how-to — per-hat section](BL-727-pilot-acceptance-contract-gate.md).

Complements the evidence-gate batch (BL-727…BL-757); this does not by itself
unlock more `/pilot safe` volume.

Acceptance:
`specs/features/BL-758-pilot-inject-role-prompts-per-hat.feature`
