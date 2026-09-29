# BL-1793 review evidence — stamp of hotfix cb8d502fec

## Goal 1 — scenarios green against the real generator + real respawn-env-args

`node specs/pipeline/cli.js specs/features/BL-1793-swarm-stamp-a-respawn-keeps-a-local-seat-local.feature`:
all 6 cases pass (Scenario 01 x2, Scenario 02 x4), ~6.4s total. Both step
handler When steps drive `write_role_launch_script` via `zsh -c "source
swarmforge.sh ...; parse_config; write_role_launch_script ..."` (the same
generator invocation `test_aider_seat_launch_config.sh` and
`bl1708SwarmStampAiderContextWindowSteps.js` use) and
`provider-respawn-env-args` via `bb -e` against a fixture `.swarmforge`
state dir — no reimplementation of either. Scenario 01 also serves as the
agreement check BL-897 asks for: the guard text scenario 01 exercises comes
from a real generated script (`swarmforge.sh`'s own launch-script writer),
not a hand-copied string.

## Goal 2 — the three cited lanes, one run each

- `bb swarmforge/scripts/test/provider_compat_lib_test_runner.bb`:
  `37 assertions ok`.
- `bash swarmforge/scripts/test/test_handoffd_auth_observe_wiring.sh`:
  3 PASS (01, 02, 03).
- `bash swarmforge/scripts/test/test_swarm_ensure.sh`: `ALL PASS`
  (RC-1..RC-13 and the rest of the suite), ~104s.

## Goal 3 — probes (no fix; each confirmed finding is a note to the specifier)

### 3a — the respawner's own flag

`provider_respawn_env_lib.bb`'s `provider-respawn-env-args` reads
`SWARMFORGE_USE_CEREBRAS` / `_PERPLEXITY` / `_QWEN` / `_BAI` via
`System/getenv` — i.e. from whichever process (`swarm_ensure.bb`,
`handoffd.bb`, `babysitterd`/`babysitter_check.bb`) is running the
respawn, not from the target seat's own launch script. The hotfix left
this on purpose; it is a real, separate leak surface from the one it
closed.

Census of `start-swarm-*.sh` (the daemons' own launch environment):
every cloud-pack launcher (`start-swarm-anthropic.sh`, `-cursor.sh`,
`-gemini.sh`, `-gpt.sh`, `-mistral.sh`) explicitly `unset`s
`SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN`
(and `OPENAI_API_BASE`/`OPENAI_BASE_URL` where applicable) before setting
its own pack's flag if any. Two launchers set a flag for the *whole*
process tree the daemons inherit: `start-swarm-glm.sh` exports
`SWARMFORGE_USE_BAI=1` unconditionally, `start-swarm-qwen.sh` exports
`SWARMFORGE_USE_QWEN=1` unconditionally. Neither Ollama launcher
(`start-swarm-ollama-qwen*.sh`) sets any `SWARMFORGE_USE_*` flag — they
only unset the three and point `OPENAI_API_BASE`/`OPENAI_BASE_URL` at
`127.0.0.1:11434`. **Finding (confirmed): a daemon started under
`start-swarm-glm.sh` or `start-swarm-qwen.sh` inherits
`SWARMFORGE_USE_BAI=1` / `SWARMFORGE_USE_QWEN=1` in its own environment,
so `provider-respawn-env-args` forces that provider's OPENAI_* vars onto
*every* seat it respawns, regardless of what that seat's own launch
script or pack window line names — including a seat with no cloud host in
its window line at all (e.g. glm-mono-router.conf's `specifier` seat,
`claude master --model claude-fable-5-1`, no host).** This is not the
hotfix's bug (the hotfix only changed launch-CLI-text matching) and not a
regression it introduced; it is a pre-existing, still-open gap in the
respawner's own flag path. Fixture run: computing
`provider-respawn-env-args` for role `coder` with `SWARMFORGE_USE_BAI=1`
set in the calling env and a local-Ollama launch script (no b.ai host)
returns `SWARMFORGE_USE_BAI=1` plus `OPENAI_API_KEY`/`OPENAI_API_BASE`/
`OPENAI_BASE_URL` pointed at `api.b.ai/v1` — confirmed by inspection of
`provider_respawn_env_lib.bb` lines 40-51 (unconditional `System/getenv`
reads, no cross-check against the target role's own launch script).

The swarmforge.sh 2026-09-09 comment (near line 2258, "coordinator's
claude-sonnet-5 process picked up ANTHROPIC_BASE_URL=api.b.ai purely
because the launching shell had SWARMFORGE_USE_BAI=1 set for its aider
siblings") is a *different*, already-fixed instance: that was the
claude-agent launch-script branch host-sniffing on `--model glm*` instead
of trusting the bare flag, fixed at launch-script-generation time, not at
respawn time. It is not evidence of this hotfix's bug and not evidence of
probe 3a's gap either — it is a third, already-closed leak on the same
family of flags. Follow-up: sent as a `note` (priority `00`) to the
specifier, naming this finding and this evidence file (separate ticket;
out of scope here per the ticket's own `out_of_scope`).

### 3b — nested guard defeating the `fi`-anchored regex

`flag-guarded-block-re` in `provider_compat_lib.bb`
(`#"(?ms)^[ \t]*if \[\[ ... :-\}\" == \"1\".*?^[ \t]*fi\b"`) is a lazy
match ending at the first line-start `fi`. Read every
`SWARMFORGE_USE_*`-flag-guarded block `swarmforge.sh` writes
(`cerebras_guard`, both branches of `perplexity_guard`, `qwen_guard`'s two
call sites, both branches of `bai_guard`, and the claude-agent qwen/b.ai
`billing_guard` branches): every one is a single-level
`if [[ ... ]]; then ... elif ... else ... fi` block with no inner
`if`/`fi` pair. **Finding: latent, not reachable today** — no guard the
generator currently emits nests an `if`/`fi`, so the regex's lazy-match
truncation never fires against real output. Measured at mint (see goal 2
of this evidence, item 1): a no-cloud-host script strips exactly 3 guarded
blocks and leaves 0 `SWARMFORGE_USE` references; a Perplexity/b.ai-host
script strips 2 (its own targeting guard is unconditional-on-host, not
flag-guarded, and stays active by design) — both match the ticket's
measured-at-mint expectation. No follow-up note: nothing to probe further
without a hypothetical new guard shape.

### 3c — a seat on a cloud provider through a flag only

Census of every pack's window lines plus the `start-swarm-*.sh` set: no
live pack has a seat that is *supposed* to reach a cloud provider only
through a bare `SWARMFORGE_USE_*` flag with no host in its own window
line — `glm-mono-router.conf` and `qwen-mono-router.conf`'s aider seats
all carry an explicit `--openai-api-base <cloud host>`; their one seat
with no host (glm's `specifier`, a `claude`/`claude-fable-5-1` seat) is
deliberately a subscription seat, unaffected by `SWARMFORGE_USE_BAI`
functionally (Claude Code does not read `OPENAI_*`). The
pre-hotfix failure mode this ticket describes — "every script read as
Cerebras-targeting, so a respawn re-flagged a seat whose window line names
no host, by accident" — is therefore not reproducible from a *design*
seat today; the one candidate (glm's specifier) is inert to the leak
functionally, not protected by any guard. This overlaps 3a's finding
(the flag still gets forced onto that seat's pane env on respawn from any
of the three callers; it is just harmless for a Claude-only process). No
new follow-up beyond 3a's note.

## Goal 4 — live end-to-end proof (record only)

No ensure-respawn-of-an-Ollama-seat event since 2026-09-28T22:11Z is
observable from this worktree: this coder worktree's own `.swarmforge/`
carries no daemon log recording an `auth-respawn` or `respawn-pane`
event, and this ticket is scoped to a review from a pipeline worktree,
not the live swarm host's process table. Recording: none found from here.
The hotfix ledger row (`backlog/hotfix-ledger.yaml`, commit `cb8d502fec`)
still reads `state: pending`, `human_decision: null` — unchanged by this
parcel per the ticket's own constraint.

## Invariant check

`git diff main...HEAD --name-only` for this parcel touches only: this
evidence file, the feature file (landed via main merge, pre-existing),
its step handler `bl1793SwarmStampRespawnKeepsLocalSeatLocalSteps.js`, and
no edits to `provider_compat_lib.bb`, `provider_respawn_env_lib.bb`,
`swarmforge.sh`, or `provider_compat_lib_test_runner.bb`.

**Declared invariant, no executable property test — stated reason.** The
declared invariant ("the stamp never rewrites the hotfix") quantifies over
this parcel's own diff shape (which paths a specific commit touches), not
over the input/output space of a pure testable module a generator can
exercise; there is no reachable-states argument to make for "which files a
one-off review commit changes." It is checked here by direct inspection
(`git diff main...HEAD --name-only`, listed above) and is re-checked by
every downstream role and by QA's own gate before merge.
