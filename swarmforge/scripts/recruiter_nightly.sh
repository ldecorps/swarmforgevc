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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

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

# BL-1701: "a local pack is live" - an aider-agent row in the live
# .swarmforge/roles.tsv whose own tmux session actually exists. Narrower
# than live_swarm() above (which already gates the whole nightly run):
# checked again just before the steward probe, since a pack can come up
# mid-run, and because the probe and a live aider seat both want this
# host's single inference slot even in a shape live_swarm() might miss.
local_pack_aider_live() {
  local roles_tsv="$ROOT/.swarmforge/roles.tsv"
  [[ -f "$roles_tsv" ]] || return 1
  local role worktree root_col session display agent recv rest
  while IFS=$'\t' read -r role worktree root_col session display agent recv rest; do
    [[ "$agent" == "aider" ]] || continue
    local sock
    for sock in "$root_col"/.swarmforge/tmux/*.sock; do
      [[ -S "$sock" ]] || continue
      if tmux -S "$sock" has-session -t "$session" 2>/dev/null; then return 0; fi
    done
  done < "$roles_tsv"
  return 1
}

# BL-1701: the model steward's own probe (coder + hazard fixture
# scenarios), kept AFTER the recruiter/battery candidates above so the two
# never contend for this host's single llama-server inference slot at
# once. STEWARD_PROBE_MODELS names the model(s) to probe (space-
# separated); absent -> no probe (item 3). Stands down, writing no
# scorecard, while a local pack's aider seat is live.
# STEWARD_PROBE_STAND_IN is a test-only escape hatch (never for operator
# use, same convention as the CLI's own --stand-in) that forwards
# --stand-in <mode> instead of spawning a real model.
run_steward_probe() {
  if local_pack_aider_live; then
    log "steward probe: stood down - a local pack's aider seat is live"
    return 0
  fi
  local models="${STEWARD_PROBE_MODELS:-}"
  if [[ -z "$models" ]]; then
    log "steward probe: no probe configured (STEWARD_PROBE_MODELS unset)"
    return 0
  fi
  local model probe_args
  for model in $models; do
    log "steward probe: running for $model"
    probe_args=(probe "$model" --all)
    if [[ -n "${STEWARD_PROBE_STAND_IN:-}" ]]; then
      probe_args+=(--stand-in "$STEWARD_PROBE_STAND_IN" --wall-clock-seconds 30 --max-ticks 300 --fix-turns-limit 1)
    fi
    probe_args+=(--evidence-dir "$ROOT/backlog/evidence")
    bb "$SCRIPT_DIR/model_steward_cli.bb" "${probe_args[@]}" >>"$LOG" 2>&1 || true
  done
}

# BL-1701: the top-level run wrapped in main(), guarded below, so a test
# can `source` this file for its function definitions alone (log/
# local_pack_aider_live/run_steward_probe) and exercise the steward-probe
# path in isolation, without live_swarm()'s own broader gate (which would
# otherwise short-circuit the whole script before the probe is ever
# reached) or a real recruiter_weekly.sh/Hugging Face candidate pass.
main() {
  ROOT="$(cd "${1:?usage: recruiter_nightly.sh <project-root> [max-candidates]}" && pwd)"
  MAX="${2:-${RECRUITER_NIGHTLY_MAX:-3}}"
  STATE="$ROOT/.swarmforge/recruiter"
  LOG="$STATE/recruiter-nightly.log"
  OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
  mkdir -p "$STATE" "$(dirname "$OUTBOX")"

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

  # BL-1701: after the candidate/battery passes above, never beside them -
  # two llama-server runners on this CPU starve each other.
  run_steward_probe

  exit 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
