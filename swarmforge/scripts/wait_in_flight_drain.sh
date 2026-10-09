#!/usr/bin/env bash
# wait_in_flight_drain.sh — soft shift-close drain.
#
# Waits until every live role's inbox/in_process is empty (each seat has
# pushed forward or bounced its current ticket). inbox/new may still hold
# mail — that is deliberate: new jobs were frozen at T−15.
#
# Prints a single outcome token to stdout: drained | forced
# Default timeout 4 hours; override with SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS.
#
# Usage: wait_in_flight_drain.sh [project-root]
set -u
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
TIMEOUT_MS="${SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS:-14400000}"
POLL_MS="${SWARMFORGE_SHIFT_CLOSE_DRAIN_POLL_MS:-15000}"
LOG="${WAIT_IN_FLIGHT_DRAIN_LOG:-$ROOT/.swarmforge/operator/day-shift.log}"
HELPER="$(mktemp "${TMPDIR:-/tmp}/wait-in-flight-drain.XXXXXX.js")"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() {
  local line
  line="$(ts) wait-in-flight-drain $*"
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  echo "$line" >>"$LOG"
}

cleanup() { rm -f "$HELPER"; }
trap cleanup EXIT

cd "$ROOT" || { echo "forced"; exit 1; }

cat >"$HELPER" <<'NODE'
const path = require('path');
const fs = require('fs');
const root = process.argv[2];
const timeoutMs = Number(process.argv[3]) || 14400000;
const pollMs = Number(process.argv[4]) || 15000;
const { isInFlightEmpty, resolveLiveRoles } = require(path.join(
  root,
  'extension/out/tools/telegramPipelineDrain.js'
));

function snapshot() {
  const { buildRoleInboxes } = require(path.join(root, 'extension/out/watchdog/chaserMonitor.js'));
  const { scanInProcess } = require(path.join(root, 'extension/out/swarm/inboxChaser.js'));
  const roles = resolveLiveRoles(root).map((r) => r.role);
  const bits = [];
  for (const { role, inProcessDir } of buildRoleInboxes(root, roles)) {
    const ip = scanInProcess(inProcessDir).length;
    if (ip) bits.push(`${role}:in_process=${ip}`);
  }
  return bits.join(' ') || 'empty';
}

(async () => {
  const started = Date.now();
  while (!isInFlightEmpty(root)) {
    if (Date.now() - started >= timeoutMs) {
      process.stdout.write('forced');
      return;
    }
    console.error(`${new Date().toISOString()} still ${snapshot()}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  process.stdout.write('drained');
})().catch((err) => {
  console.error(err);
  process.stdout.write('forced');
  process.exitCode = 1;
});
NODE

log "=== begin root=$ROOT timeout_ms=$TIMEOUT_MS ==="
outcome="$(node "$HELPER" "$ROOT" "$TIMEOUT_MS" "$POLL_MS" 2>>"$LOG")"
log "outcome=$outcome"
printf '%s' "$outcome"
[[ "$outcome" == "drained" || "$outcome" == "forced" ]]
