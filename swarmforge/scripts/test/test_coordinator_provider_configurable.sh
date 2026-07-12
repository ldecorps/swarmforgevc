#!/usr/bin/env bash
# BL-319: the coordinator's PROVIDER becomes pack-configurable via
# `config coordinator_agent <provider>`, mirroring how BL-314 made
# model/effort configurable - the coordinator was hardcoded to "claude"
# (swarmforge.sh's provision_coordinator, register_role call) regardless
# of pack config, so a full copilot-forge switch could never move the
# coordinator off Claude quota. Same "source + explicit function calls,
# never the real tmux launch" pattern as
# test_coordinator_config_pack_override.sh.
#
# Explicitly clears any inherited SWARMFORGE_CONFIG from the calling shell
# (a coder session may itself be launched via a pack) so this test's own
# fixture conf is always the one actually resolved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

coordinator_extra_cli() {
  local out_dir="$1"
  local line_no
  line_no="$(grep -nx "coordinator" "$out_dir/roles.txt" | cut -d: -f1)"
  sed -n "${line_no}p" "$out_dir/extra_cli_args.txt"
}

coordinator_agent() {
  local out_dir="$1"
  local line_no
  line_no="$(grep -nx "coordinator" "$out_dir/roles.txt" | cut -d: -f1)"
  sed -n "${line_no}p" "$out_dir/agents.txt"
}

run_fixture() {
  local root="$1"
  local out_dir="$root/.out"
  mkdir -p "$out_dir"
  env -u SWARMFORGE_CONFIG zsh -c "
    source '$SWARMFORGE_SH' '$root'
    parse_config
    print -l -- \"\${ROLES[@]}\" > '$out_dir/roles.txt'
    print -l -- \"\${AGENTS[@]}\" > '$out_dir/agents.txt'
    print -l -- \"\${EXTRA_CLI_ARGS[@]}\" > '$out_dir/extra_cli_args.txt'
  "
  echo "$out_dir"
}

# ── coordinator-provider-configurable-01: a pack's config coordinator_agent
#      line sets the provisioned coordinator's provider, and its launch
#      flags drop the Claude-only ones ─────────────────────────────────────
ROOT1="$(mk_fixture_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_agent copilot
window coder claude coder --model x
CONF
OUT1="$(run_fixture "$ROOT1")"
AGENT1="$(coordinator_agent "$OUT1")"
CLI1="$(coordinator_extra_cli "$OUT1")"
[[ "$AGENT1" == "copilot" ]] || fail "01: expected the coordinator provisioned with the copilot provider, got: $AGENT1"
[[ "$CLI1" != *"--dangerously-skip-permissions"* && "$CLI1" != *"--effort"* ]] \
  || fail "01: expected no Claude-only flags in a copilot coordinator's extra_cli, got: $CLI1"
pass "coordinator-provider-configurable-01: a pack's config coordinator_agent line switches the provisioned coordinator's provider, dropping Claude-only flags"
rm -rf "$ROOT1"

# ── coordinator-provider-configurable-02: absent line falls back to claude,
#      with today's exact flags unchanged ──────────────────────────────────
ROOT2="$(mk_fixture_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
CONF
OUT2="$(run_fixture "$ROOT2")"
AGENT2="$(coordinator_agent "$OUT2")"
CLI2="$(coordinator_extra_cli "$OUT2")"
[[ "$AGENT2" == "claude" ]] || fail "02: expected the coordinator to default to claude, got: $AGENT2"
[[ "$CLI2" == *"--dangerously-skip-permissions"* && "$CLI2" == *"--effort high"* && "$CLI2" == *"--model claude-sonnet-5"* ]] \
  || fail "02: expected today's exact default claude flags unchanged, got: $CLI2"
pass "coordinator-provider-configurable-02: absent coordinator_agent defaults to claude with today's exact launch flags"
rm -rf "$ROOT2"

# ── coordinator-provider-configurable-03: an unknown provider fails launch
#      loudly, with the SAME message a bogus window-line agent already
#      gets (validate_agent is shared, not a second allow-list) ───────────
ROOT3="$(mk_fixture_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_agent bogus
window coder claude coder --model x
CONF
ERROR_OUTPUT="$(env -u SWARMFORGE_CONFIG zsh -c "source '$SWARMFORGE_SH' '$ROOT3'; parse_config" 2>&1 || true)"
echo "$ERROR_OUTPUT" | grep -qi "Unsupported agent 'bogus' for role 'coordinator'" \
  || fail "03: expected the same 'Unsupported agent' error a bogus window-line agent gets, got: $ERROR_OUTPUT"
pass "coordinator-provider-configurable-03: an unknown coordinator_agent fails launch loudly with the shared allow-list's own error"
rm -rf "$ROOT3"

# ── coordinator-provider-configurable-04: the provisioned coordinator's
#      agent reaches roles.tsv (the same file handoffd.bb's load-roles
#      reads to pick wake-steps per role, per BL-316's generalized sweep -
#      already provider-agnostic there, so this is the one real contract
#      point: the coordinator's row must actually carry the configured
#      provider, not a hardcoded "claude") ─────────────────────────────────
ROOT4="$(mk_fixture_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_agent copilot
window coder claude coder --model x
CONF
OUT4_DIR="$ROOT4/.out"
mkdir -p "$OUT4_DIR"
env -u SWARMFORGE_CONFIG zsh -c "
  source '$SWARMFORGE_SH' '$ROOT4'
  parse_config
  write_roles_file
"
ROLES_TSV="$ROOT4/.swarmforge/roles.tsv"
[[ -f "$ROLES_TSV" ]] || fail "04: expected roles.tsv to be written"
COORDINATOR_ROW="$(grep -P '^coordinator\t' "$ROLES_TSV" || true)"
[[ -n "$COORDINATOR_ROW" ]] || fail "04: expected a coordinator row in roles.tsv, got: $(cat "$ROLES_TSV")"
COORDINATOR_AGENT_COL="$(echo "$COORDINATOR_ROW" | cut -f6)"
[[ "$COORDINATOR_AGENT_COL" == "copilot" ]] \
  || fail "04: expected roles.tsv's coordinator row to carry the configured copilot provider (column 6), got: $COORDINATOR_ROW"
pass "coordinator-provider-configurable-04: the configured provider reaches roles.tsv, the same file handoffd.bb reads to pick a role's wake-steps"
rm -rf "$ROOT4"

echo "ALL PASS"
