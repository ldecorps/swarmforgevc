#!/usr/bin/env bash
# BL-203: repeatable smoke check for the stabilize-two-pack daemon-on
# workflow (the profile behind the "Run Extension (two-pack stabilize ·
# daemon on)" launch config). Verifies the static wiring an operator or QA
# needs before trusting that profile: the profile file itself, and that
# launch.json's entry actually points at it with the daemon left on.
#
# Deliberately non-destructive and side-effect-free: it does not launch or
# stop a swarm. To additionally verify a currently-running daemon's health,
# run verify_daemon_lifecycle.sh against the same root separately.
#
# Usage: smoke_check_stabilize_two_pack.sh [root]
set -euo pipefail

ROOT="${1:-$(pwd)}"
ROOT="$(cd "$ROOT" && pwd -P)"
PROFILE="$ROOT/swarmforge/profiles/stabilize-two-pack.conf"
LAUNCH_JSON="$ROOT/.vscode/launch.json"
LAUNCH_NAME="Run Extension (two-pack stabilize · daemon on)"
PROFILE_VAR='${workspaceFolder}/swarmforge/profiles/stabilize-two-pack.conf'

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
ok() { echo "SMOKE OK: $*"; }

[[ -f "$PROFILE" ]] || fail "stabilize-two-pack profile missing at $PROFILE"

mapfile -t roles < <(grep -E '^window ' "$PROFILE" | awk '{print $2}')
expected=(coordinator coder cleaner)
if [[ "${roles[*]:-}" != "${expected[*]}" ]]; then
  fail "profile defines roles [${roles[*]:-<none>}], expected [${expected[*]}] (coordinator+coder+cleaner only, per BL-203 scope)"
fi
ok "profile defines exactly ${expected[*]}"

if grep -q 'SWARMFORGE_SKIP_DAEMON' "$PROFILE"; then
  fail "profile sets SWARMFORGE_SKIP_DAEMON — this profile must exercise handoffd routing (daemon on), not skip it"
fi
ok "profile leaves handoffd on (no SWARMFORGE_SKIP_DAEMON)"

[[ -f "$LAUNCH_JSON" ]] || fail "launch.json missing at $LAUNCH_JSON"

node -e '
const fs = require("fs");
const [launchJsonPath, launchName, profileVar] = process.argv.slice(1);
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(launchJsonPath, "utf8"));
} catch (e) {
  console.error("launch.json is not valid JSON: " + e.message);
  process.exit(1);
}
const cfg = (parsed.configurations || []).find((c) => c.name === launchName);
if (!cfg) {
  console.error(`no launch configuration named "${launchName}"`);
  process.exit(1);
}
const envConfig = cfg.env && cfg.env.SWARMFORGE_CONFIG;
const settingsConfig = cfg.settings && cfg.settings["swarmforge.configPath"];
if (envConfig !== profileVar || settingsConfig !== profileVar) {
  console.error(
    `launch config "${launchName}" does not point at ${profileVar} (env=${envConfig}, settings=${settingsConfig})`
  );
  process.exit(1);
}
if (cfg.env && cfg.env.SWARMFORGE_SKIP_DAEMON === "1") {
  console.error(`launch config "${launchName}" sets SWARMFORGE_SKIP_DAEMON=1 — daemon must stay on`);
  process.exit(1);
}
' "$LAUNCH_JSON" "$LAUNCH_NAME" "$PROFILE_VAR" \
  || fail "launch.json wiring check failed (see above)"
ok "launch.json's \"$LAUNCH_NAME\" config points at the stabilize-two-pack profile with the daemon on"

echo "SMOKE PASS: stabilize-two-pack profile + launch wiring verified."
echo "(To also verify a running daemon's health, run: swarmforge/scripts/verify_daemon_lifecycle.sh $ROOT)"
