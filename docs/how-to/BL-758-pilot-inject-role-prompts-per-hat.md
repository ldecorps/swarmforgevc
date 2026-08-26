# /pilot reinjects each live role prompt at hat change (BL-758)

## Rule

At each hat change and bounce-back, reinject `composePilotStagePrompt(ticket, role)`:
thin pilot isolation wrapper **plus** the full live `swarmforge/roles/<role>.prompt`
bytes (QA → `QA.prompt`). Do not wear every hat from one mega-brief alone.

Each `NN-<role>/verdict.json` must record `role_prompt_path` and
`role_prompt_sha256`. Land refuses `reasonKind: pilot-hat-prompt-missing` when either
is absent.

## Surfaces

| Surface | Location |
| --- | --- |
| Stage composer | `composePilotStagePrompt` |
| Start brief | `composePilotExpeditorPrompt` (PER-HAT REINJECT) |
| Land gate | `checkPerHatRolePromptEvidence` |

Acceptance:
`specs/features/BL-758-pilot-inject-role-prompts-per-hat.feature`
