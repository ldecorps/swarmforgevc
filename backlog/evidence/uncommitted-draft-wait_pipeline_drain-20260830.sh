#!/usr/bin/env bash
# wait_pipeline_drain.sh — BL-423 empty definition (no inbox/new or in_process
# parcels on any live role). Used by day-shift-bedtime before ./finish-shift.
#
# Prints a single outcome token to stdout: drained | forced
# Default timeout 30 minutes (NOTE-day-shift-drain-bedtime); override with
# SWARMFORGE_CONTROL_DRAIN_TIMEOUT_MS (milliseconds, same env as Control drain).
set -u
ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
TIMEOUT_MS="${SWARMFORGE_CONTROL_DRAIN_TIMEOUT_MS:-1800000}"
POLL_MS="${SWARMFORGE_CONTROL_DRAIN_POLL_MS:-5000}"
LOG="${WAIT_PIPELINE_DRAIN_LOG:-}"
HELPER="$(mktemp "${TMPDIR:-/tmp}/wait-pipeline-drain.XXXXXX.js")"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() {
  local line
  line="$(ts) wait_pipeline_drain $*"
  if [[ -n "$LOG" ]]; then
    echo "$line" >>"$LOG"
  else
    echo "$line" >&2
  fi
}

cleanup() { rm -f "$HELPER"; }
trap cleanup EXIT

cd "$ROOT" || { echo "forced"; exit 1; }

cat >"$HELPER" <<'NODE'
const path = require('path');
const fs = require('fs');
const root = process.argv[2];
const timeoutMs = Number(process.argv[3]) || 1800000;
const pollMs = Number(process.argv[4]) || 5000;
const { isPipelineEmpty, resolveLiveRoles } = require(path.join(
  root,
  'extension/out/tools/telegramPipelineDrain.js'
));

function snapshot() {
  const bits = [];
  for (const { role, worktreePath } of resolveLiveRoles(root)) {
    const base = path.join(worktreePath || root, '.swarmforge', 'handoffs', role, 'inbox');
    let neu = 0;
    let ip = 0;
    try {
      neu = fs.readdirSync(base).filter((f) => f.endsWith('.handoff')).length;
    } catch {}
    try {
      for (const f of fs.readdirSync(path.join(base, 'in_process'))) {
        if (f.endsWith('.handoff') || f.startsWith('batch_')) ip++;
      }
    } catch {}
    if (neu || ip) bits.push(`${role}:new=${neu}:in_process=${ip}`);
  }
  return bits.join(' ') || 'empty';
}

(async () => {
  const started = Date.now();
  while (!isPipelineEmpty(root)) {
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
outcome="$(node "$HELPER" "$ROOT" "$TIMEOUT_MS" "$POLL_MS")"
log "outcome=$outcome"
printf '%s\n' "$outcome"
[[ "$outcome" == "drained" || "$outcome" == "forced" ]]
