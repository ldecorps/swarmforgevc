#!/usr/bin/env bash
# Nightly recruiter (install_recruiter_cron.sh, weeknights 22:00): up to N
# recruiter_weekly.sh passes back to back, each one Hugging Face -> one
# candidate -> Model Steward verdict, and a Steward eviction pass between
# candidates so disk never blocks the next one (human rulings 2026-09-21:
# the recruiter pass costs zero paid tokens - it is rule-based discovery
# plus local CPU inference - so run several per night; the Steward may
# delete less capable models to save space).
#
# Guards:
#   * never runs beside a live swarm - CPU/RAM contention breaks the
#     battery's live probes (timeouts read as false fails), so a live
#     tmux swarm socket means "skip tonight"
#   * sequential, never parallel
#   * stops early on nothing-new / skipped / pull-failed (no point retrying
#     the same wall N times in one night)
#
# Usage: recruiter_nightly.sh <project-root> [max-candidates]   (default 3)
set -uo pipefail

ROOT="$(cd "${1:?usage: recruiter_nightly.sh <project-root> [max-candidates]}" && pwd)"
MAX="${2:-${RECRUITER_NIGHTLY_MAX:-3}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
STATE="$ROOT/.swarmforge/recruiter"
LOG="$STATE/recruiter-nightly.log"
OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
mkdir -p "$STATE" "$(dirname "$OUTBOX")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }
notify() {
  python3 - "$OUTBOX" "$1" <<'PY'
import json, sys
open(sys.argv[1], "a").write(json.dumps({"threadId": "OPERATOR", "text": sys.argv[2]}) + "\n")
PY
}

live_swarm() {
  # A swarm is live when its tmux socket answers with any session.
  local sock
  for sock in "$ROOT"/.swarmforge/tmux/*.sock; do
    [[ -S "$sock" ]] || continue
    if tmux -S "$sock" list-sessions >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

log "=== nightly recruiter start max=$MAX ==="
if live_swarm; then
  log "skip: a swarm is live on this root (would contend for CPU/RAM)"
  notify "🧭 Nightly recruiter skipped: a swarm is live; will try tomorrow."
  exit 0
fi

ran=0; outcomes=()
for i in $(seq 1 "$MAX"); do
  log "--- candidate $i/$MAX"
  bash "$SCRIPT_DIR/recruiter_weekly.sh" "$ROOT" >>"$LOG" 2>&1
  rep="$(ls -t "$ROOT"/backlog/evidence/recruiter-weekly-*.md 2>/dev/null | head -1)"
  outcome="$(sed -n 's/^- outcome: //p' "$rep" 2>/dev/null | head -1)"
  outcomes+=("${outcome:-unknown}")
  ran=$((ran + 1))
  log "candidate $i outcome=${outcome:-unknown}"
  case "${outcome:-}" in
    nothing-new|skipped|pull-failed|discovery-error) log "stopping early on $outcome"; break ;;
  esac
  # Make room for the next one: Steward eviction keeps the seat, every
  # pack-named model and the top-2 by scorecard; drops the rest.
  python3 "$SCRIPT_DIR/model_steward_evict.py" "$ROOT" --keep "${RECRUITER_KEEP:-2}" --min-free-gb "${RECRUITER_MIN_FREE_GB:-15}" >>"$LOG" 2>&1 || true
  if live_swarm; then log "a swarm came up mid-run; stopping"; break; fi
done

summary="$(printf '%s, ' "${outcomes[@]}")"
log "=== nightly recruiter done: $ran candidate(s): ${summary%, } ==="
notify "🧭 Nightly recruiter: $ran candidate(s) — ${summary%, } (see backlog/evidence/recruiter-weekly-*.md)"
exit 0
