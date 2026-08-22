#!/usr/bin/env bash
# BL-1049: wiring test for scrub_tmux_harness_env's provider-secret half
# against a REAL throwaway tmux server, whose global environment is seeded
# from this script's own shell exactly the way ./swarm's is. The pure
# classifier is covered in isolation by
# bl1049_provider_env_scrub_test_runner.bb; what only a live server can show
# is that (a) the names really leave the SERVER, (b) a pane opened afterwards
# really cannot see them, (c) the LAUNCHER process keeps its own copy, and
# (d) an unreachable socket is a silent no-op rather than a launch abort.
#
# SAFETY (inherited from test_bl657_harness_env_scrub_wiring.sh): this file
# must NEVER print a raw `tmux show-environment -g` dump. A prior manual
# repro of this exact scenario, run from a live harness session, dumped every
# real provider API key on that shell's PATH into assistant output. Every
# assertion below greps for the ONE name it cares about and discards the
# rest, and every fixture value is a literal placeholder, never a real key.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
SCRUB_SH="$SCRIPT_DIR/../harness_env_scrub.sh"

# BL-971: every fixture root this script creates is removed on BOTH the pass
# and the throw path. lib/tmp_cleanup.sh is sourced above for parity with the
# rest of this tree, but its registry is created with `mktemp -t <template>`,
# which GNU mktemp REFUSES ("too few X's in template") - so on Linux the
# shared registry does not exist and nothing it is handed is ever swept. That
# is a pre-existing defect in the shared helper, reported rather than patched
# here; this local trap means this ticket does not add to the leak while it
# stands.
BL1049_TMP_ROOTS=()
bl1049_cleanup() {
  local d
  for d in ${BL1049_TMP_ROOTS[@]+"${BL1049_TMP_ROOTS[@]}"}; do
    [ -n "$d" ] && rm -rf -- "$d"
  done
}
trap bl1049_cleanup EXIT

# `$(...)` forks, so a helper cannot append to the array from a subshell.
# Roots are therefore made here, in the top-level shell, and named by index.
bl1049_mkroot() {
  local d
  d="$(cd "$(mktemp -d)" && pwd -P)"
  BL1049_TMP_ROOTS+=("$d")
  register_tmp_dir "$d" 2>/dev/null || true
  printf '%s\n' "$d"
}

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Every fixture secret is this literal - nothing here is a real credential.
FAKE=bl1049-placeholder-not-a-real-key

CONF_ROOT="$(bl1049_mkroot)"
SOCK_ROOT="$(bl1049_mkroot)"

CLAUDE_CONF="$CONF_ROOT/claude-only.conf"
printf '%s\n' \
  'config active_backlog_max_depth 5' \
  'window specifier claude master --model claude-opus-5' \
  'window coder claude coder --model claude-sonnet-5' > "$CLAUDE_CONF"

VIBE_CONF="$CONF_ROOT/one-vibe-window.conf"
printf '%s\n' \
  'window coder claude coder --model claude-sonnet-5' \
  'window documenter vibe documenter --max-price 2.00' > "$VIBE_CONF"

mk_sock() { printf '%s\n' "$SOCK_ROOT/$1.sock"; }

# ═══════════════════════════════════════════════════════════════════════════
# (a) a claude-only configuration: every provider secret leaves the server,
#     and BL-657's deliberate passthroughs stay.
# ═══════════════════════════════════════════════════════════════════════════

SOCK_A="$(mk_sock a)"
RESULT_A="$CONF_ROOT/result-a.txt"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
  OPENAI_API_KEY="$FAKE" MISTRAL_API_KEY="$FAKE" TELEGRAM_BOT_TOKEN="$FAKE" \
  RESEND_API_KEY="$FAKE" CLAUDE_CODE_OAUTH_TOKEN="$FAKE" \
  CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096 CLAUDE_CODE_CHILD_SESSION="$FAKE" \
  SWARMFORGE_ENV_SCRUB_CONF="$CLAUDE_CONF" \
  bash -c "
    source '$SCRUB_SH'
    tmux -S '$SOCK_A' new-session -d -s bl1049 'sleep 120' >/dev/null 2>&1
    scrub_tmux_harness_env '$SOCK_A'
    tmux -S '$SOCK_A' show-environment -g 2>/dev/null | sed 's/=.*//'
    tmux -S '$SOCK_A' kill-server >/dev/null 2>&1
  " > "$RESULT_A" 2>/dev/null

for gone in OPENAI_API_KEY MISTRAL_API_KEY TELEGRAM_BOT_TOKEN RESEND_API_KEY; do
  grep -qx "$gone" "$RESULT_A" \
    && fail "a: $gone still named by the tmux server's global environment after the scrub"
done
pass "a: a claude-only configuration scrubs every provider secret from the tmux server"

grep -qx CLAUDE_CODE_CHILD_SESSION "$RESULT_A" \
  && fail "a: BL-657's harness-marker scrub regressed - CLAUDE_CODE_CHILD_SESSION survived"
pass "a: BL-657's harness-marker scrub still runs alongside the provider scrub"

for kept in CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_MAX_OUTPUT_TOKENS; do
  grep -qx "$kept" "$RESULT_A" \
    || fail "a: deliberate passthrough $kept was scrubbed - invariant 2 breach"
done
pass "a: the deliberate CLAUDE_CODE_* passthroughs survive the provider scrub"
rm -f "$RESULT_A"

# ═══════════════════════════════════════════════════════════════════════════
# (b) one vibe window keeps MISTRAL_API_KEY; the rest still go.
# ═══════════════════════════════════════════════════════════════════════════

SOCK_B="$(mk_sock b)"
RESULT_B="$CONF_ROOT/result-b.txt"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
  OPENAI_API_KEY="$FAKE" MISTRAL_API_KEY="$FAKE" TELEGRAM_BOT_TOKEN="$FAKE" \
  SWARMFORGE_ENV_SCRUB_CONF="$VIBE_CONF" \
  bash -c "
    source '$SCRUB_SH'
    tmux -S '$SOCK_B' new-session -d -s bl1049 'sleep 120' >/dev/null 2>&1
    scrub_tmux_harness_env '$SOCK_B'
    tmux -S '$SOCK_B' show-environment -g 2>/dev/null | sed 's/=.*//'
    tmux -S '$SOCK_B' kill-server >/dev/null 2>&1
  " > "$RESULT_B" 2>/dev/null

grep -qx MISTRAL_API_KEY "$RESULT_B" \
  || fail "b: a configured vibe window lost MISTRAL_API_KEY - a scrub that breaks a configured provider is worse than the leak"
pass "b: a configured vibe window keeps MISTRAL_API_KEY"

for gone in OPENAI_API_KEY TELEGRAM_BOT_TOKEN; do
  grep -qx "$gone" "$RESULT_B" \
    && fail "b: $gone survived on a vibe configuration - only what the config needs may stay"
done
pass "b: the secrets a vibe configuration does not need are still scrubbed"
rm -f "$RESULT_B"

# ═══════════════════════════════════════════════════════════════════════════
# (c) a pane opened AFTER the scrub cannot see a scrubbed secret, and the
#     LAUNCHER process still can (invariant 1: handoffd forks from it and
#     reads RESEND_API_KEY for briefing email).
# ═══════════════════════════════════════════════════════════════════════════

SOCK_C="$(mk_sock c)"
RESULT_C="$CONF_ROOT/result-c.txt"
PANE_OUT="$CONF_ROOT/pane-c.txt"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
  OPENAI_API_KEY="$FAKE" RESEND_API_KEY="$FAKE" \
  SWARMFORGE_ENV_SCRUB_CONF="$CLAUDE_CONF" \
  bash -c "
    source '$SCRUB_SH'
    tmux -S '$SOCK_C' new-session -d -s bl1049 'sleep 120' >/dev/null 2>&1
    scrub_tmux_harness_env '$SOCK_C'
    # A pane created after the scrub, exactly as create_role_session does.
    tmux -S '$SOCK_C' new-session -d -s bl1049-after \\
      'env | grep -c \"^OPENAI_API_KEY=\" > \"$PANE_OUT\"; sleep 5' >/dev/null 2>&1
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -s '$PANE_OUT' ] && break
      sleep 0.3
    done
    # Invariant 1: the launcher process's own copy is untouched.
    printf 'LAUNCHER_RESEND=%s\n' \"\${RESEND_API_KEY:-MISSING}\"
    printf 'LAUNCHER_OPENAI=%s\n' \"\${OPENAI_API_KEY:-MISSING}\"
    tmux -S '$SOCK_C' kill-server >/dev/null 2>&1
  " > "$RESULT_C" 2>/dev/null

[ -s "$PANE_OUT" ] || fail "c: the post-scrub pane never reported (fixture did not run)"
grep -qx 0 "$PANE_OUT" \
  || fail "c: a pane opened after the scrub still inherited OPENAI_API_KEY (count: $(cat "$PANE_OUT"))"
pass "c: a pane opened after the scrub cannot see a scrubbed secret"

grep -qx "LAUNCHER_RESEND=$FAKE" "$RESULT_C" \
  || fail "c: the LAUNCHER process lost RESEND_API_KEY - handoffd forks from it and would lose briefing email (invariant 1)"
grep -qx "LAUNCHER_OPENAI=$FAKE" "$RESULT_C" \
  || fail "c: the LAUNCHER process lost OPENAI_API_KEY - only the tmux SERVER's environment may be narrowed (invariant 1)"
pass "c: the launcher process's own environment keeps every provider secret"
rm -f "$RESULT_C" "$PANE_OUT"

# ═══════════════════════════════════════════════════════════════════════════
# (d) an unreachable socket changes nothing and fails nothing - the launch
#     must never abort over a server that has not started yet.
# ═══════════════════════════════════════════════════════════════════════════

SOCK_D="$(mk_sock d)"
RESULT_D="$CONF_ROOT/result-d.txt"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE \
  SWARMFORGE_ENV_SCRUB_CONF="$CLAUDE_CONF" OPENAI_API_KEY="$FAKE" \
  bash -c "
    source '$SCRUB_SH'
    scrub_tmux_harness_env '$SOCK_D'
    printf 'EXIT=%s\n' \"\$?\"
    [ -e '$SOCK_D' ] && printf 'SOCKET_CREATED\n'
    scrub_tmux_harness_env ''
    printf 'EMPTY_EXIT=%s\n' \"\$?\"
  " > "$RESULT_D" 2>/dev/null

grep -qx "EXIT=0" "$RESULT_D" \
  || fail "d: scrubbing an unreachable socket must report success, got: $(cat "$RESULT_D")"
grep -qx "EMPTY_EXIT=0" "$RESULT_D" \
  || fail "d: scrubbing with no socket argument must report success, got: $(cat "$RESULT_D")"
grep -qx "SOCKET_CREATED" "$RESULT_D" \
  && fail "d: the scrub started a tmux server on an unreachable socket - it must remove nothing and start nothing"
pass "d: an unreachable socket is a silent no-op that reports success"
rm -f "$RESULT_D"

# ═══════════════════════════════════════════════════════════════════════════
# (e) fail-open: no readable configuration means the keep-list is unknown,
#     so nothing is scrubbed. Losing a configured provider's credentials is
#     a worse defect than the leak this ticket fixes.
# ═══════════════════════════════════════════════════════════════════════════

SOCK_E="$(mk_sock e)"
RESULT_E="$CONF_ROOT/result-e.txt"
MISSING_CONF="$CONF_ROOT/nonexistent.conf"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
  OPENAI_API_KEY="$FAKE" \
  SWARMFORGE_ENV_SCRUB_CONF="$MISSING_CONF" \
  bash -c "
    source '$SCRUB_SH'
    HARNESS_ENV_SCRUB_SELF_DIR='$MISSING_CONF-dir'
    tmux -S '$SOCK_E' new-session -d -s bl1049 'sleep 120' >/dev/null 2>&1
    scrub_tmux_harness_env '$SOCK_E'
    tmux -S '$SOCK_E' show-environment -g 2>/dev/null | sed 's/=.*//'
    tmux -S '$SOCK_E' kill-server >/dev/null 2>&1
  " > "$RESULT_E" 2>/dev/null

grep -qx OPENAI_API_KEY "$RESULT_E" \
  || fail "e: with no readable configuration the scrub removed OPENAI_API_KEY anyway - it must fail OPEN, not guess"
pass "e: an unreadable configuration scrubs nothing rather than guessing a keep-list"
rm -f "$RESULT_E"

# ═══════════════════════════════════════════════════════════════════════════
# (f) zsh and bash agree. THE LIVE LAUNCHER IS ZSH: swarmforge.sh is a zsh
#     script and sources this library. zsh does not word-split an unquoted
#     parameter (SH_WORD_SPLIT is off by default), so `for b in $backends`
#     ran ONCE per launch with every backend name glued into one token, no
#     case arm matched, and the scrub silently failed open - while every
#     assertion above, all of them bash, passed. A bash-only wiring test
#     proved nothing about the shell that actually runs this code.
# ═══════════════════════════════════════════════════════════════════════════

command -v zsh >/dev/null 2>&1 || { echo "SKIP: f: no zsh on this host"; echo "ALL PASS: BL-1049 provider env scrub wiring"; exit 0; }

for conf in "$CLAUDE_CONF" "$VIBE_CONF"; do
  bash_list="$(env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
    SWARMFORGE_ENV_SCRUB_CONF="$conf" \
    bash -c "source '$SCRUB_SH'; harness_env_provider_scrub_vars" | sort | tr '\n' ' ')"
  zsh_list="$(env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
    SWARMFORGE_ENV_SCRUB_CONF="$conf" \
    zsh -c "source '$SCRUB_SH'; harness_env_provider_scrub_vars" | sort | tr '\n' ' ')"
  [ -n "$bash_list" ] \
    || fail "f: bash computed an EMPTY scrub list for $(basename "$conf") - the comparison below would be vacuous"
  [ "$bash_list" = "$zsh_list" ] \
    || fail "f: zsh and bash disagree for $(basename "$conf") - bash=[$bash_list] zsh=[$zsh_list]"
done
pass "f: zsh and bash compute the same scrub list (the launcher is zsh)"

# And the same under a real zsh against a real server, not just the list.
SOCK_F="$(mk_sock f)"
RESULT_F="$CONF_ROOT/result-f.txt"
env -u SWARMFORGE_CONFIG -u CONFIG_FILE -u SWARMFORGE_OPENROUTER_ROLES \
  OPENAI_API_KEY="$FAKE" MISTRAL_API_KEY="$FAKE" CLAUDE_CODE_OAUTH_TOKEN="$FAKE" \
  SWARMFORGE_ENV_SCRUB_CONF="$VIBE_CONF" \
  zsh -c "
    source '$SCRUB_SH'
    tmux -S '$SOCK_F' new-session -d -s bl1049 'sleep 120' >/dev/null 2>&1
    scrub_tmux_harness_env '$SOCK_F'
    tmux -S '$SOCK_F' show-environment -g 2>/dev/null | sed 's/=.*//'
    tmux -S '$SOCK_F' kill-server >/dev/null 2>&1
  " > "$RESULT_F" 2>/dev/null

grep -qx OPENAI_API_KEY "$RESULT_F" \
  && fail "f: under zsh - the launcher's real shell - OPENAI_API_KEY survived the scrub"
grep -qx MISTRAL_API_KEY "$RESULT_F" \
  || fail "f: under zsh the configured vibe window lost MISTRAL_API_KEY"
grep -qx CLAUDE_CODE_OAUTH_TOKEN "$RESULT_F" \
  || fail "f: under zsh the deliberate CLAUDE_CODE_OAUTH_TOKEN passthrough was scrubbed"
pass "f: a real zsh scrubs and keeps exactly what a real bash does, on a live server"
rm -f "$RESULT_F"

echo "ALL PASS: BL-1049 provider env scrub wiring"
