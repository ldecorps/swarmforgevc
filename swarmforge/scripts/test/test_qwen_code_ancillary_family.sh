#!/usr/bin/env bash
# BL-1052 (specifier amendment 2026-08-22, answer 2): a qwen-code pack must
# not demand an agent it never uses.
#
# ancillary_provider_family_for_pack routed `qwen-*` - and, via its catch-all
# arm, ANY pack name merely containing `qwen` - to the openai_aider family,
# which hard-requires `aider` on PATH and supplies aider-shaped model
# defaults. A qwen-code pack uses the `qwen` binary and never touches aider,
# so on a host with no aider installed the launch refused. Renaming the pack
# could not escape it: both arms match.
#
# The existing aider-based qwen-mono-router pack must keep behaving exactly
# as before - that is the other half of every check here.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKS="$(cd "$SRC/../packs" && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

unset SWARMFORGE_PACK
# shellcheck source=../ancillary_provider_lib.sh
source "$SRC/ancillary_provider_lib.sh"

mk_root() {
  local conf="$1" root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/.swarmforge"
  printf 'active_backlog_max_depth_conf_path\t%s\n' "$conf" > "$root/.swarmforge/swarm-identity"
  echo "$root"
}

# A PATH with no aider on it, so "does this pack demand aider?" is answered by
# the code rather than by whatever happens to be installed on this host. Keeps
# the system directories (bash and coreutils live there) and asserts up front
# that aider is genuinely unreachable through it - otherwise check 05, which
# expects the aider pack to REFUSE, would be the thing that silently broke.
NO_AIDER_BIN="$(mktemp -d)"
register_tmp_dir "$NO_AIDER_BIN"
for tool in qwen; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$NO_AIDER_BIN/$tool"
  chmod +x "$NO_AIDER_BIN/$tool"
done
NO_AIDER_PATH="$NO_AIDER_BIN:/usr/bin:/bin"

# ancillary_provider_load sources "$HOME/.zshenv", which on a real host puts
# ~/.local/bin (where aider lives) back on PATH and re-exports live provider
# keys over any fixture value. Point HOME at an empty fixture dir so that
# source is a no-op: the PATH under test stays the PATH under test, and no
# real credential can wander into this run.
FIXTURE_HOME="$(mktemp -d)"
register_tmp_dir "$FIXTURE_HOME"
# Exported for the WHOLE script, not just the subshell checks: the in-process
# ancillary_provider_load calls below source it too, and with the real HOME an
# actual Qwen key was re-exported over the fixture value and then printed by a
# failing assertion. No assertion here prints a credential VALUE for the same
# reason - they name the variable and check the value separately.
export HOME="$FIXTURE_HOME"

# And nothing real from the launching shell either. Every one of these is
# exported by a developer's ~/.zshenv on this host, and a test that let one
# through would be asserting about a live credential instead of its fixture.
unset QWEN_API_KEY BAILIAN_TOKEN_PLAN_API_KEY BAILIAN_CODING_PLAN_API_KEY \
      BAILIAN_API_KEY DASHSCOPE_API_KEY OPENAI_API_KEY 2>/dev/null || true
PATH="$NO_AIDER_PATH" command -v aider >/dev/null 2>&1 \
  && fail "fixture: aider is reachable through the no-aider PATH ($NO_AIDER_PATH); checks 04/05 would not mean what they say"
PATH="$NO_AIDER_PATH" command -v qwen >/dev/null 2>&1 \
  || fail "fixture: the stub qwen binary is not reachable through the no-aider PATH"

# Scratch output stays inside a registered fixture dir, never /tmp directly.
OUT_DIR="$(mktemp -d)"
register_tmp_dir "$OUT_DIR"

# ── 01: the qwen-code pack gets its own family, not the aider one ─────────
QC_ROOT="$(mk_root "$PACKS/qwen-code-mono-router.conf")"
export QWEN_API_KEY=qwen-secret
ancillary_provider_load "$QC_ROOT"
[[ "$(ancillary_provider_pack)" == qwen-code-mono-router ]] \
  || fail "01: pack name not resolved from swarm-identity, got: $(ancillary_provider_pack)"
[[ "$(ancillary_provider_family)" == qwen_code ]] \
  || fail "01: qwen-code pack resolved family '$(ancillary_provider_family)', expected qwen_code"
pass "01: qwen-code-mono-router resolves to its own qwen_code family"

# ── 02: the arm wins over BOTH matching arms, not just the glob ───────────
# The case's `qwen-*` arm and the catch-all's `*qwen*` test both match this
# name; the fix has to be ordered ahead of each.
[[ "$(ancillary_provider_family_for_pack qwen-code-mono-router)" == qwen_code ]] \
  || fail "02: the qwen-* glob still claims qwen-code-mono-router"
[[ "$(ancillary_provider_family_for_pack some-qwen-code-pack)" == qwen_code ]] \
  || fail "02: the catch-all *qwen* arm still claims a name containing qwen-code"
pass "02: both the glob arm and the catch-all arm yield to qwen_code"

# ── 03: the pre-existing aider pack is untouched ──────────────────────────
[[ "$(ancillary_provider_family_for_pack qwen-mono-router)" == openai_aider ]] \
  || fail "03: qwen-mono-router no longer resolves to openai_aider"
for p in perplexity-mono-router cerebras-mono-router vibe-mono-router; do
  [[ "$(ancillary_provider_family_for_pack "$p")" == openai_aider ]] \
    || fail "03: $p no longer resolves to openai_aider"
done
[[ "$(ancillary_provider_family_for_pack gemini-mono-router)" == gemini ]] \
  || fail "03: gemini-mono-router regressed"
[[ "$(ancillary_provider_family_for_pack mono-router)" == claude_direct ]] \
  || fail "03: mono-router regressed"
pass "03: every pre-existing pack keeps the family it had"

# ── 04: the qwen-code pack launches on a host with no aider ───────────────
# qa_e2e_procedure step 5a, made executable.
QC_ROOT4="$(mk_root "$PACKS/qwen-code-mono-router.conf")"
( set +e
  PATH="$NO_AIDER_PATH" HOME="$FIXTURE_HOME" QWEN_API_KEY=qwen-secret \
  bash -c "
    source '$SRC/ancillary_provider_lib.sh'
    ancillary_provider_load '$QC_ROOT4'
    ancillary_provider_require_credentials
  " >$OUT_DIR/qc-req.out 2>&1
  echo $? > $OUT_DIR/qc-req.rc
)
QC_RC="$(cat $OUT_DIR/qc-req.rc)"; rm -f $OUT_DIR/qc-req.rc
[[ "$QC_RC" == 0 ]] \
  || fail "04: qwen-code pack refused to launch with no aider on PATH: $(cat $OUT_DIR/qc-req.out)"
grep -qi 'aider' $OUT_DIR/qc-req.out \
  && fail "04: qwen-code credential check still mentions aider: $(cat $OUT_DIR/qc-req.out)"
rm -f $OUT_DIR/qc-req.out
pass "04: the qwen-code pack comes up on a host with no aider installed"

# ── 05: and the aider pack still demands aider on that same host ──────────
# The negative half: if 04 passed because the aider requirement had been
# dropped for EVERY family, this fails.
QW_ROOT="$(mk_root "$PACKS/qwen-mono-router.conf")"
( set +e
  PATH="$NO_AIDER_PATH" HOME="$FIXTURE_HOME" QWEN_API_KEY=qwen-secret \
  bash -c "
    source '$SRC/ancillary_provider_lib.sh'
    ancillary_provider_load '$QW_ROOT'
    ancillary_provider_require_credentials
  " >$OUT_DIR/qw-req.out 2>&1
  echo $? > $OUT_DIR/qw-req.rc
)
QW_RC="$(cat $OUT_DIR/qw-req.rc)"; rm -f $OUT_DIR/qw-req.rc
[[ "$QW_RC" != 0 ]] \
  || fail "05: the aider-based pack no longer requires aider - the requirement was dropped globally, not scoped"
rm -f $OUT_DIR/qw-req.out
pass "05: the aider-based pack still requires aider on the same host"

# ── 06: a qwen-code pack still needs its own credential ───────────────────
( set +e
  PATH="$NO_AIDER_PATH" HOME="$FIXTURE_HOME" \
  env -u QWEN_API_KEY -u BAILIAN_CODING_PLAN_API_KEY -u BAILIAN_TOKEN_PLAN_API_KEY \
  bash -c "
    source '$SRC/ancillary_provider_lib.sh'
    ancillary_provider_load '$QC_ROOT4'
    ancillary_provider_require_credentials
  " >$OUT_DIR/qc-nokey.out 2>&1
  echo $? > $OUT_DIR/qc-nokey.rc
)
NOKEY_RC="$(cat $OUT_DIR/qc-nokey.rc)"; rm -f $OUT_DIR/qc-nokey.rc
[[ "$NOKEY_RC" != 0 ]] \
  || fail "06: the qwen-code pack came up with no credential at all"
grep -q 'QWEN_API_KEY' $OUT_DIR/qc-nokey.out \
  || fail "06: the refusal does not name the credential it needs: $(cat $OUT_DIR/qc-nokey.out)"
rm -f $OUT_DIR/qc-nokey.out
pass "06: a qwen-code pack with no credential refuses, naming QWEN_API_KEY"

# ── 07: the pane gets the Token Plan endpoint and the key, never aider's ──
QC_ROOT7="$(mk_root "$PACKS/qwen-code-mono-router.conf")"
export QWEN_API_KEY=qwen-secret
ancillary_provider_load "$QC_ROOT7"
EXPORTS="$(ancillary_provider_pane_exports)"
grep -q 'OPENAI_API_KEY="\$QWEN_API_KEY"' <<<"$EXPORTS" \
  || fail "07: pane exports do not map the Qwen key onto OPENAI_API_KEY: $EXPORTS"
grep -q 'token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' <<<"$EXPORTS" \
  || fail "07: pane exports do not carry the Token Plan endpoint: $EXPORTS"
grep -q 'qwen-secret' <<<"$EXPORTS" \
  && fail "07: the credential VALUE was written into the pane exports rather than referenced by name"
ancillary_provider_fill_tmux_env
TMUX_ENV_NAMES="$(printf '%s\n' ${ANCILLARY_TMUX_ENV[@]+"${ANCILLARY_TMUX_ENV[@]}"} | sed 's/=.*//')"
grep -qx 'QWEN_API_KEY' <<<"$TMUX_ENV_NAMES" \
  || fail "07: the key does not reach the pane via tmux -e; names passed: $(tr '\n' ' ' <<<"$TMUX_ENV_NAMES")"
[[ " ${ANCILLARY_TMUX_ENV[*]} " == *"QWEN_API_KEY=qwen-secret"* ]] \
  || fail "07: tmux -e carries QWEN_API_KEY but not the value this test exported (value withheld)"
pass "07: the qwen-code pane gets the Token Plan endpoint and the key via -e"

# ── 08: the family's default model is the pack's, not aider's sonar ───────
[[ "$(ancillary_provider_default_model front_desk)" == "qwen3.6-flash" ]] \
  || fail "08: qwen-code front_desk default model is $(ancillary_provider_default_model front_desk), expected the pack's coordinator_model"
[[ "$(ancillary_provider_default_model operator)" != "openai/sonar" ]] \
  || fail "08: qwen-code still falls back to the aider family's openai/sonar default"
pass "08: the qwen-code family's default model comes from its own pack"

echo "ALL PASS"
