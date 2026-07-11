#!/usr/bin/env bash
# Smoke test for the Support MVP runtime (support_runtime.bb), BL-275 —
# mirrors test_operator_runtime_tick.sh's own shape, trimmed to this
# slice's scope (no provider-cooldown, no swarm-check timer; reminder/close
# timers are BL-276, not this skeleton). Runs --tick-once against isolated
# temp fixtures with no tmux and no real LLM launch (SUPPORT_SKIP_LAUNCH).
# Asserts the command-file -> event -> dispatch -> reap cycle and the
# status.json schema.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/support" "$d/swarmforge/scripts"
  cp "$SRC/support_lib.bb" "$SRC/support_runtime.bb" "$SRC/launch_support.sh" "$d/swarmforge/scripts/"
  printf '%s' "$d"
}
tick() { SUPPORT_SKIP_LAUNCH=1 bb "$1/swarmforge/scripts/support_runtime.bb" "$1" --tick-once; }
jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }

# ── 1. no command, no pending events: idle, nothing launched ────────────────
F="$(make_fixture)"
OUT="$(tick "$F")"
check "idle tick reports launched? false"       '[[ "$OUT" == *"\"launched?\":false"* ]]'
check "status.json written"                     '[[ -f "$F/.swarmforge/support/status.json" ]]'
check "state idle"                              '[[ "$(jget "$F/.swarmforge/support/status.json" ":state")" == idle ]]'
check "heartbeat written"                       '[[ -f "$F/.swarmforge/support/heartbeat" ]]'
rm -rf "$F"

# ── 2. a dropped command file: event queued, dispatch fires, moved to inflight ─
F="$(make_fixture)"
echo "caller wants to talk" > "$F/.swarmforge/support/command"
OUT2="$(tick "$F")"
check "command-file tick reports launched? true" '[[ "$OUT2" == *"\"launched?\":true"* ]]'
check "command file consumed"                    '[[ ! -f "$F/.swarmforge/support/command" ]]'
check "state dispatching"                        '[[ "$(jget "$F/.swarmforge/support/status.json" ":state")" == dispatching ]]'
check "pending-count >= 1"                       '[[ "$(jget "$F/.swarmforge/support/status.json" ":pending-count")" -ge 1 ]]'
check "events moved to inflight"                 '[[ -f "$F/.swarmforge/support/events.inflight.jsonl" ]]'
check "no events.jsonl left behind"              '[[ ! -f "$F/.swarmforge/support/events.jsonl" ]]'

# ── 3. second tick: Support not running -> reap; back to idle ───────────────
OUT3="$(tick "$F")"
check "second tick does not relaunch"            '[[ "$OUT3" == *"\"launched?\":false"* ]]'
check "state back to idle"                       '[[ "$(jget "$F/.swarmforge/support/status.json" ":state")" == idle ]]'
check "inflight reaped to events-done"            '[[ -n "$(ls "$F/.swarmforge/support/events-done/" 2>/dev/null)" ]]'
rm -rf "$F"

# ── 4. launcher assembles a --remote-control command, named "Support" ───────
# BL-275 QA bounce (2026-07-11): a fixture root with NO swarmforge/roles/
# support.prompt (today's real state, since it is a separate specifier
# deliverable) must NOT assemble --append-system-prompt-file pointing at a
# missing path — that is exactly what made every real (non-dry-run) launch
# exit 1 before the disposable LLM ever started. Uses its own isolated
# fixture root (not $SRC/..'s real repo path) so this is never accidentally
# green just because the real file happens to exist by the time this runs.
NOPROMPT_ROOT="$(mktemp -d)"
DRY="$(SUPPORT_LAUNCH_DRYRUN=1 bash "$SRC/launch_support.sh" "$NOPROMPT_ROOT" /tmp/x.jsonl 2>&1 || true)"
check "support named 'Support' (not a swarm agent)"  '[[ "$DRY" == *"--remote-control Support"* ]]'
check "support NOT named SwarmForge-Support"         '[[ "$DRY" != *"SwarmForge-Support"* ]]'
check "no prompt file -> --append-system-prompt-file is OMITTED, never a dangling path"  '[[ "$DRY" != *"--append-system-prompt-file"* ]]'
rm -rf "$NOPROMPT_ROOT"

# When the prompt DOES exist (once the specifier lands it), the launcher
# must pick it up automatically - a regression guard for that future state.
WITHPROMPT_ROOT="$(mktemp -d)"
mkdir -p "$WITHPROMPT_ROOT/swarmforge/roles"
echo "You are Support." > "$WITHPROMPT_ROOT/swarmforge/roles/support.prompt"
DRY2="$(SUPPORT_LAUNCH_DRYRUN=1 bash "$SRC/launch_support.sh" "$WITHPROMPT_ROOT" /tmp/x.jsonl 2>&1 || true)"
check "an existing prompt file IS passed via --append-system-prompt-file"  '[[ "$DRY2" == *"--append-system-prompt-file $WITHPROMPT_ROOT/swarmforge/roles/support.prompt"* ]]'
rm -rf "$WITHPROMPT_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "support_runtime smoke: ALL CHECKS PASSED"
else
  echo "support_runtime smoke: FAILURES"; exit 1
fi
