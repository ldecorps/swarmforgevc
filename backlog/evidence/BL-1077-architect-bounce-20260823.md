# BL-1077 architect bounce — 2026-08-23

Commit reviewed: `1dab45412a` (same cleaner tip as the BL-1082 parcel —
multi-ticket batch, Article 2.6).

This is the second `git_handoff` of that tip (cleaner forwarded each ticket
separately). Architecture review of BL-1077's own surfaces was completed in
the same pass as
`backlog/evidence/BL-1082-architect-bounce-20260823.md`.

## Review inventory (Article 4.4 — one bounce)

### Gates run (BL-1077 surfaces)

- Declared invariant encoding:
  `swarmforge/scripts/test/test_qwen_credential_name_invariant.sh` — green;
  shared name set + preferred order across
  `qwen_launch_guard_lib.sh`, `start-swarm-qwen.sh`,
  `ancillary_provider_lib.sh`; `swarmforge.sh` sources the lib.
- Unit: `test_qwen_launch_guard_lib.sh` — green (token-plan preferred,
  coding-plan legacy, explicit QWEN_API_KEY wins, refusal names all three,
  soft branch maps).
- Step registry: `bl1077DocumentedQwenCredentialNameSteps` registered in
  `specs/pipeline/steps/index.js`.
- Dependency / host-I/O / secrets: launch-guard stays in swarmforge scripts;
  fixture-only credentials in tests — **PASSED**.

### D1 — Same tip blocked by sibling BL-1082 invariant-unencoded (blame: coder)

BL-1077's own inventory is **NONE**. The tip cannot be forwarded to
hardender while `1dab45412a` still carries BL-1082 D1 (vacuous invariant-2
property test). Forwarding this parcel alone would ship the defective
BL-1082 encoding on the same commit (BL-506 / Article 2.6: one tip, every
ticket).

#### Remediation

1. Clear BL-1082 D1 per
   `backlog/evidence/BL-1082-architect-bounce-20260823.md`.
2. Re-forward **both** BL-1082 and BL-1077 as separate `git_handoff`s from
   the fixed tip (same per-ticket discipline as the inbound batch).

No separate revert of architect tip for this second bounce: the BL-1082
bounce already reverted the review merge (`701a95cb6e`); content of
`1dab45412a` is not live on `swarmforge-architect`.
