# BL-523 evidence (QA close 2026-07-18)

## Stage trail (mono-router)
- coder → cleaner (commit `bd1b89c3`) — completed
- cleaner → architect (`bd1b89c3`) — completed
- architect → hardender (`bd1b89c3`) — completed
- hardender → documenter (`d1e40e6f`) — completed (forced rotate after hardender API stalls)
- documenter → QA — documenter stalled on wrong handoff commit (`6e2009e9` = BL-519);
  closed by human mono-router impersonation (documenter + QA)

## Verification
- Implementation: `role_uses_openrouter` + OpenRouter billing_guard + `-e OPENROUTER_API_KEY` in `swarmforge/scripts/swarmforge.sh` (landed `bd1b89c3`; chase/ensure/rotate keep the same `-e`).
- Acceptance: `bash swarmforge/scripts/test/test_openrouter_provider_support.sh` — all 6 scenarios PASS.
- Feature: `specs/features/BL-523-openrouter-provider-support.feature`
- Docs: `swarmforge/handoff-protocol.md` (provider section + respawn/rotate notes); pack `openrouter-cheap-mono-router.conf`

## Residual risks
- OpenRouter **key monthly limit** can 403 while account credits remain — operators must raise the key cap.
- Non-Anthropic model slugs depend on OpenRouter Anthropic Skin compatibility.
