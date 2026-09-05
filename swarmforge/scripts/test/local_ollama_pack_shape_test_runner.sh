#!/usr/bin/env bash
# BL-1142 unit scenarios for local_ollama_pack_shape_lib + gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../local_ollama_pack_shape_lib.sh"
GATE="$SCRIPT_DIR/../local_ollama_pack_shape_gate.sh"
# shellcheck source=../local_ollama_pack_shape_lib.sh
source "$LIB"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── 01: mono-router depth 1 classifies correctly ──────────────────────────
MONO=$'config active_backlog_max_depth 1\nconfig rotation router\nwindow coder aider coder --model x\n'
[[ "$(bl1142_classify_pack_shape "$MONO")" == "mono-router" ]] \
  || fail "01: expected mono-router"
pass "01: mono-router depth 1"

# ── 02: standing multi-window without depth is uncapped ───────────────────
UNCAPPED=$'window coder a\nwindow specifier b\nwindow cleaner c\n'
[[ "$(bl1142_classify_pack_shape "$UNCAPPED")" == "uncapped-forge" ]] \
  || fail "02: expected uncapped-forge"
pass "02: uncapped standing multi-seat"

# ── 02b: router depth above mono max is capped-forge (not uncapped) ───────
# Hardener BL-1142: kills flipping the router capped branch to uncapped.
CAPPED_ROUTER=$'config active_backlog_max_depth 2\nconfig rotation router\nwindow coder a\n'
[[ "$(bl1142_classify_pack_shape "$CAPPED_ROUTER")" == "capped-forge" ]] \
  || fail "02b: expected capped-forge for router depth 2"
pass "02b: router depth>mono max is capped-forge"

# ── 03: mono decision allows only mono-router ─────────────────────────────
bl1142_shape_allowed_for_local_decision mono-router || fail "03: mono allowed"
bl1142_shape_allowed_for_local_decision capped-forge && fail "03: capped must refuse"
bl1142_shape_allowed_for_local_decision uncapped-forge && fail "03: uncapped must refuse"
pass "03: decision allows mono-router only"

# ── 04: forbidden substitute packs ────────────────────────────────────────
bl1142_is_forbidden_substitute_pack qwen-forge || fail "04: qwen-forge forbidden"
bl1142_is_forbidden_substitute_pack ollama-qwen3-mono-router && fail "04: mono not forbidden"
pass "04: qwen-forge forbidden; mono allowed"

# ── 05: gate accepts real mono pack; refuses uncapped fixture ─────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir "$ROOT"
mkdir -p "$ROOT/swarmforge/packs"
printf '%s\n' "$MONO" > "$ROOT/swarmforge/packs/ollama-qwen3-mono-router.conf"
bash "$GATE" "$ROOT" ollama-qwen3-mono-router >/dev/null \
  || fail "05: gate must accept mono pack"

printf '%s\n' "$UNCAPPED" > "$ROOT/swarmforge/packs/local-fake-forge.conf"
if bash "$GATE" "$ROOT" local-fake-forge >/dev/null 2>&1; then
  fail "05: gate must refuse uncapped local-fake-forge"
fi
printf '%s\n' "$CAPPED_ROUTER" > "$ROOT/swarmforge/packs/local-capped-router.conf"
if bash "$GATE" "$ROOT" local-capped-router >/dev/null 2>&1; then
  fail "05: gate must refuse capped-forge router depth>mono"
fi
pass "05: gate accepts mono; refuses uncapped and capped-router"

# ── 06: gate refuses qwen-forge by name even if conf exists ───────────────
printf '%s\n' "$MONO" > "$ROOT/swarmforge/packs/qwen-forge.conf"
if bash "$GATE" "$ROOT" qwen-forge >/dev/null 2>&1; then
  fail "06: gate must refuse qwen-forge substitute"
fi
pass "06: gate refuses qwen-forge substitute"

rm -rf "$ROOT"
echo "BL-1142 local_ollama_pack_shape: ALL PASS"
