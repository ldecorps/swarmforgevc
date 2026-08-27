# BL-1049 — role panes stop inheriting every provider secret

## Problem

`tmux new-session` seeds the tmux SERVER's global environment from the
entire launching shell, and every pane the server opens afterwards
inherits a copy. [BL-657](BL-657-launcher-tmux-server-dies-seconds-after-launch.md)
added a scrub for Claude Code / Cursor harness markers, but never for
provider credentials. On the live swarm, all seven role panes (all
`claude` in the running configuration) inherited all fifteen provider
secrets that happened to be exported in the launching shell —
`OPENAI_API_KEY`, `MISTRAL_API_KEY`, `TELEGRAM_BOT_TOKEN`, and twelve
others — even though zero of them is read by any pipeline role.

## Cause

Nothing before this scrubbed provider credentials from the tmux server's
global environment; only harness markers were in scope.

## Fix

The tmux-server scrub gets a second, separately named set: provider
secrets, minus a **keep-list derived from the running configuration**
(never a hand-maintained allowlist) — computed from each `window <role>
<backend> ...` line in `swarmforge.conf`.

1. `swarmforge/scripts/harness_env_scrub_lib.bb` — `provider-secret-vars`
   (the fifteen names), `backend-provider-vars` (what each backend reads —
   `claude`/`copilot`/`grok` read none; `vibe` reads `MISTRAL_API_KEY`;
   `aider` reads eight, and so on), `provider-keep-names` (union of every
   configured backend's needs plus BL-657's `keep-vars`), and
   `provider-scrub-vars`/`provider-secret-names` (the actual names to
   remove from a real `tmux show-environment -g` capture).
2. `swarmforge/scripts/harness_env_scrub.sh` — the shell twin, applying
   the same classification with the same keep-list logic.
3. Applied only inside `scrub_tmux_harness_env`, at the two call sites
   BL-657 already established (`swarmforge.sh:1046` and `:1862`). No new
   call site, and `swarmforge.sh` itself is otherwise untouched.

**The launcher process's own environment is deliberately NOT touched.**
`start_handoff_daemon` forks `handoffd` from the launcher shell — not into
a tmux pane — after the launcher scrub runs, and `handoffd` reads
`RESEND_API_KEY` from that inherited environment for briefing email.
Extending the launcher-process scrub to provider keys would silently break
briefing email while leaving the actual leak (the tmux server) untouched.
Only the tmux-server scrub grows.

**Fail-open, deliberately, in both directions:**
- An unreadable `swarmforge.conf` (empty backend set) scrubs **nothing** —
  it never guesses which secrets are safe to remove.
- A backend name the map doesn't recognize keeps **every** secret for that
  draw — an unrecognized backend costs the swarm its leak, never a
  configured provider's credentials.

Both fail-open directions land on invariant 2: a scrub that breaks a
configured provider is a worse defect than the leak it fixes.

**Deliberately out of scope**, named so it isn't folded in silently:
per-**role** narrowing (a `vibe` documenter pane keeping `MISTRAL_API_KEY`
while six `claude` panes on the same server do not needs its own per-window
`-e` passthrough on `create_role_session`). Recorded as a follow-up slice
on the `swarm-reliability` epic.

**Incidental fix found and corrected along the way**: `harness_env_scrub_names.bb`'s
CLI wrapper called `harness-marker-names`, which did not exist on `main` —
dead code left over from two BL-657 implementations merging with the
explicit list winning. Now defined and covered by BL-657's own
pre-existing test runners.

## Verify

```bash
bb swarmforge/scripts/test/bl1049_provider_env_scrub_test_runner.bb
bb swarmforge/scripts/test/bl1049_provider_env_scrub_property_runner.bb
bash swarmforge/scripts/test/test_bl1049_provider_env_scrub.sh
```

On a live swarm (after a launch built from this fix):

```bash
sock=$(ls -t .swarmforge/tmux/*.sock | head -1)
tmux -S "$sock" show-environment -g | sed 's/=.*/=<redacted>/' \
  | grep -iE 'key|token|secret'
# on an all-claude configuration: nothing but the deliberate
# CLAUDE_CODE_OAUTH_TOKEN / CLAUDE_CODE_MAX_OUTPUT_TOKENS passthroughs

tmux -S "$sock" send-keys -t swarmforge-coder:0 \
  'env | grep -c OPENAI_API_KEY' Enter   # must read 0 in the pane

tr '\0' '\n' < /proc/$(pgrep -f '[h]andoffd.bb' | head -1)/environ \
  | grep -c RESEND_API_KEY               # must still read 1 — launcher untouched
```

Flip one window to a non-Claude backend (e.g. `window documenter vibe
documenter --max-price 2.00`) and relaunch to confirm the keep-list tracks
configuration: `MISTRAL_API_KEY` should now be present in the server
global environment while the other fourteen provider secrets remain
absent.
