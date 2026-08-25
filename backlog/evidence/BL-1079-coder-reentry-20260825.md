# BL-1079 — coder re-entry after unhold — 20260825

Product already on `origin/main` (QA tip `416d2385b` is ancestor).

## Fix this pass

Scenario 04 red: APS `launcherAllowListTokens` regex omitted `-`, so
`local-model` in `validate_agent` broke the case-arm parse after BL-1052/1078.
Aligned the character class with `bl1079_provider_agent_allowlist_property_runner.bb`
(`[a-z0-9_|-]+`).

## Proof

- APS: 5/5 green
- `bl1079_provider_agent_allowlist_property_runner.bb`: ALL PASS
- `bl1079_cursor_certification_gate_property_runner.bb`: ALL PASS

No reimplementation of certify/seed; tip is the allow-list parser fix only.

By coder.
