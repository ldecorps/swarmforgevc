# BL-1077 architect pass — 2026-08-23

Commit reviewed: `a4c91681de` (cleaner tip merging the prior
`BL-1077-tip-blocked-by-BL-1082-inv2` bounce envelope after BL-1082 D1 was
cleared). Merged into architect as `d709779a41`; this evidence commit is the
forward tip (BL-536).

Prior bounce cleared:
`backlog/evidence/BL-1077-architect-bounce-20260823.md` (D1 — same tip
blocked by sibling BL-1082 vacuous invariant-2 encoding). Sibling clearance
is recorded in `backlog/evidence/BL-1082-architect-pass-20260823.md` and
already forwarded to hardender.

## Review inventory (Article 4.4)

### Gates run

- Declared invariant (BL-633/BL-654): encoded by
  `swarmforge/scripts/test/test_qwen_credential_name_invariant.sh` — shared
  name set + preferred order across `qwen_launch_guard_lib.sh`,
  `start-swarm-qwen.sh`, `ancillary_provider_lib.sh`; `swarmforge.sh` sources
  the lib. **Green.** Shell/Babashka have no fast-check lane; this shell
  encoding is the non-vacuous gate for the declared property.
- Unit: `swarmforge/scripts/test/test_qwen_launch_guard_lib.sh` — **green**
  (token-plan preferred, coding-plan legacy, explicit `QWEN_API_KEY` wins,
  refusal names all three, soft branch maps).
- Required wiring: `bl1077DocumentedQwenCredentialNameSteps` registered in
  `specs/pipeline/steps/index.js`; steps drive the real
  `qwen_launch_guard_lib.sh` with scrubbed fixture credentials only.
- Dependency gate (`extension/` cwd on the parcel's step files): no
  BL-1077-introduced forbidden edge. Full scan still reports the standing
  `telegram-front-desk-bot` ↔ `telegramCursorOperator{Exec,Liveness}`
  `acyclic` cycle — **already ticketed as BL-759**
  (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`);
  not a parcel defect (BL-759 / BL-1063).
- Co-change report: expected coupling among the new guard lib, unit/
  invariant tests, step handlers, and `swarmforge.sh`. Historical co-change
  with BL-1082 named-model surfaces is from the prior multi-ticket tip;
  **informative only**, no new boundary bounce.
- Architecture boundaries: launch-guard stays in swarmforge scripts (no
  TypeScript spawn-bypass of tmux; no webview storage; credentials remain
  env-only, never written into the target worktree). **PASSED.**
- Undeclared property pass (BL-654): BL-1077 touches no pure TS module that
  warrants an extra fast-check property beyond the declared shell invariant
  encoding. No new `*.property.test.js` added.

### Defects

NONE.
