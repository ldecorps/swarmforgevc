#!/usr/bin/env bash
# BL-314: the coordinator's model/effort become pack-configurable via
# `config coordinator_model <id>` / `config coordinator_effort <level>`,
# defaulting to claude-sonnet-5/high instead of the old hardcoded
# claude-opus-4-8. Same "source + explicit function calls, never the real
# tmux launch" pattern as test_coordinator_provisioned_infrastructure.sh
# (BL-089's ZSH_EVAL_CONTEXT toplevel guard).
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

run_fixture() {
  local root="$1"
  local out_dir="$root/.out"
  mkdir -p "$out_dir"
  env -u SWARMFORGE_CONFIG zsh -c "
    source '$SWARMFORGE_SH' '$root'
    parse_config
    print -l -- \"\${ROLES[@]}\" > '$out_dir/roles.txt'
    print -l -- \"\${EXTRA_CLI_ARGS[@]}\" > '$out_dir/extra_cli_args.txt'
  "
  echo "$out_dir"
}

# ── coordinator-model-01: a pack's config lines set the provisioned
#      coordinator's model/effort ───────────────────────────────────────────
ROOT1="$(mk_fixture_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_model claude-sonnet-5
config coordinator_effort high
window coder claude coder --model x
CONF
OUT1="$(run_fixture "$ROOT1")"
CLI1="$(coordinator_extra_cli "$OUT1")"
[[ "$CLI1" == *"--model claude-sonnet-5"* && "$CLI1" == *"--effort high"* ]] \
  || fail "01: expected the pack's declared model/effort honored, got: $CLI1"
pass "coordinator-model-01: a pack's config coordinator_model/coordinator_effort lines set the provisioned coordinator"
rm -rf "$ROOT1"

# ── coordinator-model-02: absent lines fall back to Sonnet-tier default ────
ROOT2="$(mk_fixture_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
CONF
OUT2="$(run_fixture "$ROOT2")"
CLI2="$(coordinator_extra_cli "$OUT2")"
[[ "$CLI2" == *"--model claude-sonnet-5"* && "$CLI2" == *"--effort high"* ]] \
  || fail "02: expected the Sonnet-tier default with no coordinator_model/effort lines, got: $CLI2"
pass "coordinator-model-02: absent coordinator_model/coordinator_effort falls back to claude-sonnet-5/high, not Opus"
rm -rf "$ROOT2"

# ── coordinator-model-02b: malformed (blank-value) handling is covered at
#      coordinator_config_lib.bb's own level (coordinator_config_test_runner.bb
#      + test_coordinator_config_cli.sh) - a "config coordinator_model" line
#      with NO value token at all never reaches that reader in a real
#      launch; parse_config's own pre-existing generic "config <key>
#      <value>" field-count gate rejects it as an Invalid config line
#      first, for any config keyword, not something specific to introduce
#      here.

# ── coordinator-model-03: a pack may still explicitly opt into Opus ────────
ROOT3="$(mk_fixture_root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_model claude-opus-4-8
config coordinator_effort xhigh
window coder claude coder --model x
CONF
OUT3="$(run_fixture "$ROOT3")"
CLI3="$(coordinator_extra_cli "$OUT3")"
[[ "$CLI3" == *"--model claude-opus-4-8"* && "$CLI3" == *"--effort xhigh"* ]] \
  || fail "03: expected an explicit claude-opus-4-8/xhigh to be honored, got: $CLI3"
pass "coordinator-model-03: a pack may still explicitly opt the coordinator into Opus"
rm -rf "$ROOT3"

# ── coordinator-model-04: coordinator remains rejected as a window line
#      (unchanged from BL-243) - regression already covered by
#      test_coordinator_provisioned_infrastructure.sh's own "04" case;
#      re-asserted here too since it is this ticket's own explicit
#      acceptance criterion ─────────────────────────────────────────────────
ROOT4="$(mk_fixture_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_model claude-opus-4-8
window coordinator claude master --model x
window coder claude coder --model x
CONF
ERROR_OUTPUT="$(env -u SWARMFORGE_CONFIG zsh -c "source '$SWARMFORGE_SH' '$ROOT4'; parse_config" 2>&1 || true)"
echo "$ERROR_OUTPUT" | grep -qi "coordinator is reserved infrastructure" \
  || fail "04: expected 'coordinator is reserved infrastructure', got: $ERROR_OUTPUT"
pass "coordinator-model-04: the coordinator remains rejected as a declarable window line, unchanged from BL-243"
rm -rf "$ROOT4"

# ── no other role's declared model changes: a non-coordinator role's own
#      --model flag is untouched by coordinator_model/coordinator_effort ──
ROOT5="$(mk_fixture_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config coordinator_model claude-opus-4-8
config coordinator_effort xhigh
window coder claude coder --model claude-sonnet-5
CONF
OUT5="$(run_fixture "$ROOT5")"
CODER_LINE_NO="$(grep -nx "coder" "$OUT5/roles.txt" | cut -d: -f1)"
CODER_CLI="$(sed -n "${CODER_LINE_NO}p" "$OUT5/extra_cli_args.txt")"
[[ "$CODER_CLI" == *"--model claude-sonnet-5"* && "$CODER_CLI" != *"opus"* && "$CODER_CLI" != *"xhigh"* ]] \
  || fail "05: expected the coder's own declared --model untouched by coordinator config, got: $CODER_CLI"
pass "coordinator-model-05: a non-coordinator role's own declared model is unaffected by coordinator_model/effort"
rm -rf "$ROOT5"

echo "ALL PASS"
