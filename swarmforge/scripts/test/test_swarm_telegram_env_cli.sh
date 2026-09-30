#!/usr/bin/env bash
# BL-1775: proves swarm_telegram_env_cli.bb's real output resolves and
# applies correctly under a real zsh eval - never just the pure resolver
# function in isolation. SWARMFORGE_FLEET_HOME always points at an
# isolated fixture root, never the real $HOME (which is genuinely
# populated on this host).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
CLI="$SRC/swarm_telegram_env_cli.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fleet_home() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/fleet/primary"
  printf '/nonexistent/other/primary/root' > "$d/.swarmforge/fleet/primary/root"
  printf '%s' "$d"
}

# ── 1: the recorded primary root - the CLI prints nothing to eval ──────────
FLEET_HOME="$(make_fleet_home)"
OUT="$(SWARMFORGE_FLEET_HOME="$FLEET_HOME" bb "$CLI" /nonexistent/other/primary/root primary)"
check "1: the recorded primary root prints no override lines" '[ -z "$OUT" ]'

# ── 2: a non-primary swarm with its own fleet creds file - exports it, and
# eval-ing it under a real zsh actually sets the variables ─────────────────
FLEET_HOME="$(make_fleet_home)"
mkdir -p "$FLEET_HOME/.swarmforge/fleet/second"
printf '{"botToken":"second-token","chatId":"-1002"}' > "$FLEET_HOME/.swarmforge/fleet/second/telegram.json"
OUT="$(SWARMFORGE_FLEET_HOME="$FLEET_HOME" bb "$CLI" /some/second/root second)"
check "2: a non-primary swarm with creds prints an export for the token" \
  "printf '%s' \"\$OUT\" | grep \"export TELEGRAM_BOT_TOKEN='second-token'\" >/dev/null"
check "2: a non-primary swarm with creds prints an export for the chat id" \
  "printf '%s' \"\$OUT\" | grep \"export TELEGRAM_CHAT_ID='-1002'\" >/dev/null"
# HOME is pinned to an empty scratch dir (no .zshenv of its own) for every
# eval below - never left unset. Without a HOME override, zsh still
# resolves $HOME from the real passwd entry and sources the REAL
# ~/.zshenv (this host's own, with a real Telegram token per operator
# memory) before the printed OUT lines get a chance to overwrite it -
# functionally harmless here since OUT is always non-empty and wins, but
# it needlessly reads the real profile's secret into this subprocess and
# contradicts this file's own header claim ("never the real $HOME").
EVAL_HOME="$(mktemp -d)"
register_tmp_dir "$EVAL_HOME"
EVAL_RESULT="$(env -i HOME="$EVAL_HOME" PATH="$PATH" zsh -c "$OUT"'; echo "TOKEN=${TELEGRAM_BOT_TOKEN:-}"; echo "CHAT=${TELEGRAM_CHAT_ID:-}"')"
check "2: eval-ing the printed lines under a real zsh actually sets TELEGRAM_BOT_TOKEN" \
  "printf '%s' \"\$EVAL_RESULT\" | grep '^TOKEN=second-token\$' >/dev/null"
check "2: eval-ing the printed lines under a real zsh actually sets TELEGRAM_CHAT_ID" \
  "printf '%s' \"\$EVAL_RESULT\" | grep '^CHAT=-1002\$' >/dev/null"

# ── 2b: a token/chat containing a shell-hazardous embedded single quote -
# round-tripped through a REAL zsh eval, not just checked for the raw
# substring (which would pass whether the escaping is correct OR broken:
# an unescaped splice also contains the literal substring, it just also
# breaks the shell). sh-single-quote exists precisely for this case. ────
FLEET_HOME="$(make_fleet_home)"
mkdir -p "$FLEET_HOME/.swarmforge/fleet/quoted"
HAZARD_TOKEN="a'b\$(echo pwned)\`echo pwned2\`c"
printf '{"botToken":%s,"chatId":"-1002"}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$HAZARD_TOKEN")" \
  > "$FLEET_HOME/.swarmforge/fleet/quoted/telegram.json"
OUT="$(SWARMFORGE_FLEET_HOME="$FLEET_HOME" bb "$CLI" /some/quoted/root quoted)"
EVAL_HOME2="$(mktemp -d)"
register_tmp_dir "$EVAL_HOME2"
EVAL_RESULT="$(env -i HOME="$EVAL_HOME2" PATH="$PATH" zsh -c "$OUT"'; echo "TOKEN=${TELEGRAM_BOT_TOKEN:-}"')"
check "2b: a token with an embedded quote and shell metacharacters round-trips byte-for-byte through a real zsh eval" \
  "[ \"\$(printf '%s' \"\$EVAL_RESULT\" | sed -n 's/^TOKEN=//p')\" = \"\$HAZARD_TOKEN\" ]"

# ── 3: a non-primary swarm with NO fleet creds file - unsets both, never
# leaving whatever the profile already exported ────────────────────────────
FLEET_HOME="$(make_fleet_home)"
OUT="$(SWARMFORGE_FLEET_HOME="$FLEET_HOME" bb "$CLI" /some/third/root third)"
check "3: no fleet creds file prints an unset line" '[ "$OUT" = "unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID" ]'
EVAL_HOME3="$(mktemp -d)"
register_tmp_dir "$EVAL_HOME3"
EVAL_RESULT="$(env -i HOME="$EVAL_HOME3" PATH="$PATH" TELEGRAM_BOT_TOKEN=primary-token TELEGRAM_CHAT_ID=-1001 zsh -c "$OUT"'; echo "TOKEN=${TELEGRAM_BOT_TOKEN:-<unset>}"; echo "CHAT=${TELEGRAM_CHAT_ID:-<unset>}"')"
check "3: eval-ing the unset line clears an already-exported primary token" \
  "printf '%s' \"\$EVAL_RESULT\" | grep '^TOKEN=<unset>\$' >/dev/null"
check "3: eval-ing the unset line clears an already-exported primary chat id" \
  "printf '%s' \"\$EVAL_RESULT\" | grep '^CHAT=<unset>\$' >/dev/null"

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
else
  exit 1
fi
