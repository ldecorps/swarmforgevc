# BL-1052 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `464b4f4737` (cleaner, pure merge of coder `8ad89d6fea` — no
additional cleaner diff on BL-1052 files, confirmed via
`git diff 8ad89d6fe 464b4f4737 -- swarmforge/scripts specs/pipeline/steps`
being empty) into the architect worktree. Merged cleanly, no conflicts.
Recompiled `extension/out/` before running any tool against it
(`npm run compile`, clean), per [[architect-stale-build-gotcha]].

## Scope

Slice (a) of the qwen-code onboarding (BL-1053, the ModelFactory
`provider->agent` entry and Model Steward cost class, is separate and
depends on this one — not touched here, as the ticket requires). Four
pieces: (1) `qwen-code` registered in `prompt_engine_lib.bb`'s
`provider-capabilities` as chat-message/embedded, mirroring `vibe`/`gemini`;
(2) a launch adapter in `swarmforge.sh` (`validate_agent`,
`check_backend_dependencies`, the `qwen-code` case in the launch-body
composer, the agent name added as a Token Plan force-trigger on both the
qwen guard and `launch_role`'s `use_qwen` gate); (3) a new
`qwen-code-mono-router.conf` pack + overlay `.prompt`, beside the untouched
aider-based `qwen-mono-router.conf`; (4) a `qwen-code` backend entry in
`harness_env_scrub_lib.bb` and its shell twin `harness_env_scrub.sh`. New
feature file (8 scenarios/scenario-outline rows) + step handler
(`bl1052QwenCodeSeatSteps.js`, registered in `specs/pipeline/steps/index.js`)
+ property runner (`bl1052_qwen_code_seat_property_runner.bb`, both declared
invariants) + example shell suite (`test_qwen_code_seat.sh`, 9 cases). No
`extension/**` file touched at all.

## Architecture

- Integrate-not-fork: this is maintenance of the project's own maintained
  SwarmForge fork under `swarmforge/`/`specs/pipeline/` (Local Engineering
  Architecture Rule 2) — a new pack and a new agent adapter, not a
  modification of a *user's* separately-installed SwarmForge. Not a
  violation of the extension's "drive it via `./swarm`, don't reimplement
  it" constraint, which governs the extension's own runtime relationship,
  not this repo's own fork maintenance.
- No webview/extension-host boundary, no browser storage, nothing under
  `extension/` — this parcel is entirely outside that surface.
- Secrets (both declared invariants, see below): the API key is never
  written to a pack file, a generated launch script, a prompt, or a commit —
  it reaches the pane only via the launching environment and tmux `-e`,
  matching Local Engineering Architecture Rule 4. Verified myself, not just
  read: `git show 8ad89d6fe` contains no literal key value anywhere in the
  diff (checked by grep for `sk-`/inline-assignment patterns — zero hits),
  and the property runner's P2c positive check (below) proves the key
  actually arrives via `respawn-pane -e` rather than the property being
  satisfiable by a launcher that silently drops the credential.
- Capability-vs-model separation (declared invariant 1): `qwen-code` and the
  aider-based `qwen-mono-router` pack share a model catalog, endpoint, and
  key but get distinct capability shapes (`chat-message`/`embedded` vs
  aider's `shell-run-script`) — read both entries in
  `prompt_engine_lib.bb`, confirmed they differ exactly as required.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

This parcel touches zero files under `extension/`. Passing the parcel's own
changed files errors immediately (`Can't open '...' for reading` — expected,
depcruise's config root is `extension/` and none of these paths resolve
under it). Full-repo scan instead:

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Identical to the three edges recorded in `BL-1075-architect-pass-20260822.md`
(same day, prior parcel) — pre-existing, already tracked as `BL-759`
(paused). None of this parcel's files touch either side of the cycle. Not
this parcel's scope.

## Co-change (`node extension/out/tools/co-change-report.js`)

Run against all changed files (default threshold, then `--min-frequency 3`).
At default threshold every pairing among this parcel's own new/touched files
shows exactly 1 co-change (this commit is the first time they appear
together) — nothing to flag. At `--min-frequency 3`, `swarmforge.sh` (a
large, frequently-touched hub/launcher file already coupled to dozens of
other scripts across its whole history) surfaces its usual long list of
historical co-change partners — none of them are files this parcel touches,
and none of this parcel's OTHER changed files (`prompt_engine_lib.bb`,
`harness_env_scrub_lib.bb`/`.sh`, the new pack, the new step handler) appear
in each other's high-frequency lists. This is `swarmforge.sh`'s pre-existing
hub-file profile, not new coupling introduced by BL-1052.

## Invariants review (BL-654/BL-633) — both declared, both real, both verified

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | A capability entry describes the AGENT, never the model — `qwen-code` and aider-based qwen must never share a capability shape | property runner invariant-1 block (200 map runs: model/agent pairs constructed from a shared model, not drawn independently) + feature scenarios 01/02 | Ran green myself (`bb .../bl1052_qwen_code_seat_property_runner.bb` → `ALL PROPERTIES HELD`). Read `prompt_engine_lib.bb`'s two entries by hand: `qwen-code` is `chat-message`/`embedded`; `aider` (unchanged) is `shell-run-script`. Confirmed the step handler reads the RAW map (not the `normalize-agent`-backed accessor), so a missing entry would report claude's fallback shape and fail scenario 01 — the exact fall-through `required_wiring` names. |
| 2 | The API key reaches the pane only through the launching environment and tmux `-e`; never a pack file, generated launch script, prompt, or commit | property runner invariant-2 block (40 launch runs: P2a "not written to launch script", P2b "not written to a pack/prompt file", P2c "DOES arrive via respawn-pane -e" — the positive check that stops the property being vacuously satisfied by a launcher that drops the key entirely, P2d "pack files may contain a `$VAR` reference, never a literal secret") + feature scenario 05 (Scenario Outline, 2 Examples rows: `QWEN_API_KEY`, `BAILIAN_CODING_PLAN_API_KEY`) | Ran green myself, both the property runner and `node specs/pipeline/cli.js` on the feature file (8/8 `ok`). Read the step handler's `KNOWN_CREDENTIAL_KEYS` set (BL-421 Scenario Outline rule: explicit lookup, not passthrough) and its `PROVIDER_KEYS` fixture-environment clear-list, which exists specifically because `~/.zshenv` re-exports real keys on this host — matches [[zshenv-reexports-real-keys-over-fixture-values]]. Confirmed by hand that `git show 8ad89d6fe` contains no literal secret value anywhere in the diff. |

No missing/vacuous property test for either invariant. Both are exercised
against the real `write_role_launch_script` composer and the real
`provider-capabilities` map (through Babashka), never a re-implemented
capability table or launch body, per the coder's own commit-message claim —
confirmed by reading `bl1052QwenCodeSeatSteps.js`'s header comment and its
`execFileSync('bb', ...)` / `execFileSync('zsh', ...)` calls, not just
trusting the claim.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

No touched module is a new pure-logic surface beyond what the two declared
invariants already cover. `prompt_engine_lib.bb`'s change is a map-literal
addition (already exercised by invariant 1); `swarmforge.sh`'s changes are
inside the launch-composition function the existing invariants already
drive end to end; `harness_env_scrub_lib.bb`/`.sh` additions are one map
entry each, covered by the pre-existing lib/sh parity gate (below). The
pack `.conf`/`.prompt` files are config/prose. Nothing to add.

## Correctness read-through

Read all changed files end to end. `validate_agent`'s allow-list,
`check_backend_dependencies`'s `qwen-code) check_dependency qwen ;;`
(binary name genuinely differs from the agent name — correctly handled, not
a copy-paste of the agent string), the `qwen-code` launch-body case, the
Token Plan force-trigger added to both the qwen guard's `if` and
`launch_role`'s `use_qwen` gate (necessary because the CLI reads
`OPENAI_BASE_URL` from environment only, with no `--openai-api-base` flag
the way aider packs get — matching-on-window-line-alone would have left a
seat silently talking to whatever `~/.zshenv` last exported, exactly the
class of defect the ticket's own description calls out). No defect found.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean, before running the gate.
- `node extension/out/tools/dependency-gate.js` (full-repo, post-compile):
  same 3 pre-existing BL-759 edges, confirmed above; parcel's own files
  errored as not-under-`extension/`, as expected.
- `node extension/out/tools/co-change-report.js` on all 10 parcel files,
  default and `--min-frequency 3`: reviewed above, no new coupling.
- `bash swarmforge/scripts/test/test_qwen_code_seat.sh` → **ALL PASS** (9/9).
- `bb swarmforge/scripts/test/bl1052_qwen_code_seat_property_runner.bb` →
  `ALL PROPERTIES HELD (200 map runs, 40 launch runs)`.
- `node specs/pipeline/cli.js specs/features/BL-1052-a-role-seat-can-be-staffed-by-qwen-code.feature`
  → **8/8 pass** (TAP: `# pass 8`, `# fail 0`).
- `bb swarmforge/scripts/test/harness_env_scrub_lib_test_runner.bb` →
  `ALL TESTS PASSED` (lib side of the BL-657 parity gate, unaffected).
- `bash swarmforge/scripts/test/test_harness_env_scrub_bl657.sh` → **ALL
  PASS** (4/4, shell side of the same parity gate).
- `required_wiring` verified directly, not by grep-for-comment: (1)
  `"qwen-code"` is a live key in the `provider-capabilities` map returned by
  `(load-file ...)`, not just a string appearing somewhere in the file; (2)
  `specs/pipeline/steps/index.js` line 595 is a live
  `require('./bl1052QwenCodeSeatSteps')` inside the `DOMAINS` array actually
  iterated by `registerSteps`, per
  [[required-wiring-anchor-goes-vacuous-not-absent-on-a-file-split]].

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness defect
in the parcel. Forwarding to hardener.

Note, not a bounce: `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
sits untracked in this worktree, pre-existing and unrelated to BL-1052 —
already surfaced and ticketed as BL-724 per
[[stray-mono-router-auto-rotate-test-unticketed]]. Left untouched.

— By architect.
