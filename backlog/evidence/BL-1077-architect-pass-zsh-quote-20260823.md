# BL-1077 architect pass — zsh quote fix — 2026-08-23

Commit reviewed: `879176bd6a` (cleaner tip; coder `153989ffb6` fixed
QA bounce D1, cleaner shared `qwen_lib_source` across both guard branches).
Merged into architect as `7200f653a`; this evidence commit is the forward
tip (BL-536).

Clears QA bounce:
`backlog/evidence/BL-1077-qa-bounce-20260823.md` (D1 — `$''` / single-quote
nesting left `swarmforge.sh` unparseable under zsh at the next `elif`).

## Review inventory (Article 4.4)

### Gates run

- Declared invariant (BL-633/BL-654): encoded by
  `swarmforge/scripts/test/test_qwen_credential_name_invariant.sh` — shared
  name set + preferred order across `qwen_launch_guard_lib.sh`,
  `start-swarm-qwen.sh`, `ancillary_provider_lib.sh`; `swarmforge.sh`
  sources the lib via one `qwen_lib_source` prefix; **zsh source of
  `swarmforge.sh` succeeds**. **Green.** Shell/Babashka have no fast-check
  lane; this shell encoding is the non-vacuous gate for the declared
  property (and now locks the quote-shape regression).
- Unit: `swarmforge/scripts/test/test_qwen_launch_guard_lib.sh` — **green**
  (token-plan preferred, coding-plan legacy, explicit `QWEN_API_KEY` wins,
  refusal names all three, soft branch maps).
- Required wiring: `bl1077DocumentedQwenCredentialNameSteps` still
  registered in `specs/pipeline/steps/index.js` (unchanged this tip).
- Dependency gate: parcel changed only swarmforge shell + invariant test —
  no new extension edges. Full-repo scan still reports standing
  `telegram-front-desk-bot` ↔ `telegramCursorOperator{Exec,Liveness}`
  `acyclic` cycle — **already ticketed as BL-759**
  (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`);
  not a parcel defect (BL-759 / BL-1063).
- Co-change report: historical coupling of `swarmforge.sh` with launch /
  runtime helpers is expected; co-change with the invariant test is the
  intended lock for this tip. **Informative only**, no boundary bounce.
- Architecture boundaries: launch-guard stays in swarmforge scripts (no
  TypeScript spawn-bypass of tmux; no webview storage; credentials remain
  env-only). Shared `qwen_lib_source` keeps the fragile quote shape in one
  place — both hard and soft branches cannot drift. **PASSED.**
- Undeclared property pass (BL-654): tip touches no pure TS module; no new
  `*.property.test.js`. Shell invariant + zsh source check cover the
  regression class.

### Defects

NONE.
