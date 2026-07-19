# INTAKE / INCIDENT — provider key≠API-base mismatch (Perplexity mono-router)

**Date:** 2026-07-19 ~12:50–13:00 UTC+1  
**Role:** Swarm Reliability Engineer (human+Cursor)  
**Severity:** Swarm-wide feature halt while dashboards read healthy

## Timeline

1. Active work was BL-512 (already shipped on main by human). Coder reclaim-looped the same TASK on branch `BL-526` (claim≠branch).
2. Operator babysit closed BL-512, promoted BL-528, woke panes.
3. Specifier/coder panes showed `litellm.AuthenticationError: Invalid API key` against `https://www.perplexity.ai/settings/api`.
4. Live aider processes had `OPENAI_API_KEY=sk-proj-…` (OpenAI) and **no** `OPENAI_API_BASE`, while argv carried `--openai-api-base https://api.perplexity.ai`.
5. Curl check: `PERPLEXITY_API_KEY` → HTTP 400 (valid key, bad max_tokens); OpenAI `sk-*` → Perplexity HTTP **401**.
6. On-disk `.swarmforge/launch/*.sh` had **no** perplexity remap guard (stale vs current `swarmforge.sh` writer) and coordinator launch was bare `aider --yes-always`.
7. Attempted aider kill to heal auth destroyed `swarmforge-coder` / `swarmforge-specifier` sessions. `swarm ensure` then reported them **DORMANT** (mono-router rotate targets) and did not recreate them.

## Architectural root cause

**Soft coupling** between three independently set facts:

| Fact | Source |
|------|--------|
| API host | Pack `window` line `--openai-api-base https://api.perplexity.ai` |
| Remap flag | Launching shell `SWARMFORGE_USE_PERPLEXITY=1` |
| Key in pane | tmux `-e` + launch-script guard (flag-gated) + `~/.zshenv` OPENAI |

Any one out of sync → agents speak to Perplexity with an OpenAI key → 401.  
**No invariant** refused start or healed on auth-class pane text.  
**Ensure** treats missing rotate-target sessions as healthy-dormant, so session death is permanent without full relaunch.

## Why "just restart" is wrong

A bounce with the same soft coupling recreates the same 401. The failure must become **impossible** (CLI→force remap) and **detectable** (auth text / key-family mismatch → respawn).

## Framework improvements (this incident)

1. **`provider_compat_lib.bb`** — pure decision: launch CLI implying Perplexity **forces** remap; `compat-mismatch?` for live key family.
2. **`swarmforge.sh`** — if `$extra_cli` contains `perplexity.ai`, launch script always remaps (or exits if key missing); `launch_role` sets `use_perplexity=1` from EXTRA_CLI too.
3. **`swarm_ensure.bb`** — `provider-respawn-env-args` reads the role launch script and applies `provider_compat_lib` (CLI forces remap even when ensure's env forgot the flag).
4. **Tests** — `provider_compat_lib_test_runner.bb` (TDD).
5. **Follow-on tickets** — auth-text observe→heal; mono-router session death must not be silent-dormant; coordinator `--model` (BL-530).

## Evidence citations

- Pane scrollback: AuthenticationError / Invalid API key (specifier, coder)
- Process environ: `OPENAI_API_KEY` prefix `sk-proj`, `SWARMFORGE_USE_PERPLEXITY=1`, `PERPLEXITY_API_KEY` prefix `pplx-`
- `.swarmforge/launch/coder.sh` (pre-fix): aider line with perplexity base, no remap guard
- `provider_compat_lib` regression: CLI + host sk-* → mismatch true

## Definition of done for this incident

- [x] Pure invariant + tests
- [x] Launch + ensure wire the invariant
- [ ] Live panes regenerated with guards; OPENAI key family `:perplexity`
- [ ] Auth-error observe auto-heal (ticket)
- [ ] Mono-router missing-session heal (ticket)
