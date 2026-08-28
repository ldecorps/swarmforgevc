#!/usr/bin/env bash
# BL-1199: swarm_status.bb reports the editor (vscode-tunnel) and Bubble
# named (bubble-cloudflared) tunnels as two independent rows, never one
# masking the other - the exact shape the operator saw as a single green
# "cloudflare-tunnel UP" row during the 2026-08-27 incident. Covers
# scenario status-separates-editor-and-named-tunnel-rows-02, both examples,
# against the REAL swarm_status.bb (no mocked pid checks).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT
mkdir -p "$ROOT/.swarmforge/operator"
echo "SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble" > "$ROOT/.swarmforge/operator/named-tunnel.env"

row_for() {  # <status-output> <row-name>
  echo "$1" | grep -E "^\s*\S+\s+$2\s"
}

run_status() {  # sets OUT
  OUT="$(bb "$REAL_SCRIPTS_DIR/swarm_status.bb" "$ROOT" 2>&1)"
}

# ── example 1: editor up, named down ─────────────────────────────────────
echo $$ > "$ROOT/.swarmforge/operator/tunnel.pid"
echo 99999999 > "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
run_status
row_for "$OUT" "vscode-tunnel" | grep -q "^\s*UP" \
  || fail "example1: expected vscode-tunnel UP, got: $(row_for "$OUT" "vscode-tunnel")"
row_for "$OUT" "bubble-cloudflared" | grep -q "^\s*DOWN" \
  || fail "example1: expected bubble-cloudflared DOWN, got: $(row_for "$OUT" "bubble-cloudflared")"
pass "example1: editor up / named down renders as two independent, correctly-diverging rows"

# ── example 2: editor down, named up ─────────────────────────────────────
echo 99999999 > "$ROOT/.swarmforge/operator/tunnel.pid"
echo $$ > "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
run_status
row_for "$OUT" "vscode-tunnel" | grep -q "^\s*DOWN" \
  || fail "example2: expected vscode-tunnel DOWN, got: $(row_for "$OUT" "vscode-tunnel")"
row_for "$OUT" "bubble-cloudflared" | grep -q "^\s*UP" \
  || fail "example2: expected bubble-cloudflared UP, got: $(row_for "$OUT" "bubble-cloudflared")"
pass "example2: editor down / named up renders as two independent, correctly-diverging rows"

# ── regression: no cloudflare-tunnel row survives under the old name ─────
echo "$OUT" | grep -q "cloudflare-tunnel " \
  && fail "expected the old ambiguous 'cloudflare-tunnel' row name to be gone entirely"
pass "the old ambiguous cloudflare-tunnel row name no longer appears anywhere"

# ── constraint: an unconfigured root reports NOT_CONFIGURED, never DOWN ──
rm -f "$ROOT/.swarmforge/operator/named-tunnel.env" "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
run_status
row_for "$OUT" "bubble-cloudflared" | grep -q "NOT_CONFIGURED" \
  || fail "expected bubble-cloudflared NOT_CONFIGURED with no named tunnel configured, got: $(row_for "$OUT" "bubble-cloudflared")"
row_for "$OUT" "bubble-cloudflared" | grep -q "^\s*DOWN" \
  && fail "an absent named tunnel must never render as DOWN (that reads as a fault that does not exist)"
pass "an unconfigured root reports bubble-cloudflared as NOT_CONFIGURED, never DOWN"

echo "ALL PASS"
