#!/usr/bin/env bash
# Weekly recruiter (Monday morning, install_recruiter_cron.sh): go to Hugging
# Face, pick ONE open-weight model that fits this host, and hand it to the
# Model Steward to benchmark and certify. Recruiter finds; Steward judges.
#
#   discover  -> recruiter_hf_discover.py (rule-based, no LLM in the loop)
#   acquire   -> ollama pull hf.co/<org>/<repo>:Q4_K_M, alias <name>:latest
#   register  -> model_steward_cli.bb register local/<alias>
#   benchmark -> BL-1127 coder battery + local_model_compliance_battery.py
#                (15 competencies + the 2 certify-gating safety probes)
#   certify   -> model_steward_cli.bb certify (the safety gate decides)
#   report    -> backlog/evidence/recruiter-weekly-<stamp>.md + one line to
#                the Operator Telegram topic (telegram-reply-outbox.jsonl)
#
# What it never does: launch a pack, edit a pack conf, bind a Telegram
# seat, or commit. A certified candidate is an OFFER for the human to staff.
#
# Usage: recruiter_weekly.sh <project-root> [--discover-only]
set -uo pipefail

ROOT="$(cd "${1:?usage: recruiter_weekly.sh <project-root> [--discover-only]}" && pwd)"
DISCOVER_ONLY=0; [[ "${2:-}" == "--discover-only" ]] && DISCOVER_ONLY=1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STATE="$ROOT/.swarmforge/recruiter"
LOG="$STATE/recruiter-weekly.log"
SEEN="$STATE/seen.jsonl"
OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
EVIDENCE_DIR="$ROOT/backlog/evidence"
REPORT="$EVIDENCE_DIR/recruiter-weekly-$STAMP.md"
MIN_FREE_GB="${RECRUITER_MIN_FREE_GB:-15}"
mkdir -p "$STATE" "$EVIDENCE_DIR" "$(dirname "$OUTBOX")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }

notify() {
  # Standing Operator-topic line, the same channel the chase sweep and loop
  # detector use; the front desk resolves OPERATOR to the topic id.
  python3 - "$OUTBOX" "$1" <<'PY'
import json, sys
open(sys.argv[1], "a").write(json.dumps({"threadId": "OPERATOR", "text": sys.argv[2]}) + "\n")
PY
}

finish() {
  # $1 outcome word, $2 detail; writes the report and notifies. Always exit 0
  # from cron: a recruiter that found nothing this week is not an error.
  {
    echo "# Weekly recruiter — $1"
    echo
    echo "- stamped: $STAMP"
    echo "- outcome: $1"
    echo "- detail: $2"
    [[ -n "${CAND_JSON:-}" ]] && { echo; echo "## Candidate"; echo; echo '```json'; echo "$CAND_JSON"; echo '```'; }
    [[ -n "${BATTERY_SUMMARY:-}" ]] && { echo; echo "## Battery"; echo; echo "$BATTERY_SUMMARY"; }
    echo
    echo "Recruiter finds, Steward judges: nothing here staffs a seat. A certified"
    echo "candidate is an offer; a refused one names why in its scorecard."
  } > "$REPORT"
  log "outcome=$1 report=$REPORT"
  notify "🧭 Weekly recruiter: $1 — $2 (report: backlog/evidence/$(basename "$REPORT"))"
  exit 0
}

log "=== weekly recruiter start root=$ROOT discover_only=$DISCOVER_ONLY ==="

# ── discover ─────────────────────────────────────────────────────────────
DISC="$(python3 "$SCRIPT_DIR/recruiter_hf_discover.py" "$ROOT" 2>>"$LOG")" || finish "discovery-error" "recruiter_hf_discover.py failed: $(echo "$DISC" | head -c 200)"
CAND_JSON="$(echo "$DISC" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["candidate"], indent=2) if d.get("candidate") else "")')"
[[ -z "$CAND_JSON" ]] && finish "nothing-new" "$(echo "$DISC" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("reason","no candidate"))')"

HF_ID="$(echo "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hf_id"])')"
PULL="$(echo "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ollama_pull"])')"
ALIAS="$(echo "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["alias"])')"
log "candidate hf_id=$HF_ID pull=$PULL alias=$ALIAS"
# Mark seen NOW, before anything can fail: the same candidate must not be
# re-picked every Monday if the pull or battery keeps breaking.
printf '%s\n' "$(python3 -c 'import json,sys; print(json.dumps({"hf_id": sys.argv[1], "alias": sys.argv[2], "stamp": sys.argv[3]}))' "$HF_ID" "$ALIAS" "$STAMP")" >> "$SEEN"

[[ "$DISCOVER_ONLY" -eq 1 ]] && finish "discovered" "$HF_ID (discover-only run; not pulled or benchmarked)"

# ── preflight (lessons of 2026-09-20/21) ─────────────────────────────────
command -v ollama >/dev/null 2>&1 || finish "skipped" "ollama not on PATH"
curl -s -m 10 http://127.0.0.1:11434/api/tags >/dev/null || finish "skipped" "ollama serve is not answering on 127.0.0.1:11434"
MODELS_DIR="$(ollama show qwen2.5-coder:latest --modelfile 2>/dev/null | sed -n 's/^FROM \(.*\)\/blobs\/.*/\1/p' | head -1)"
MODELS_DIR="${MODELS_DIR:-$HOME/.ollama/models}"
FREE_GB="$(df -BG "$MODELS_DIR" 2>/dev/null | awk 'NR==2{gsub("G","",$4); print $4}')"
if [[ -n "$FREE_GB" && "$FREE_GB" -lt "$MIN_FREE_GB" ]]; then
  finish "skipped" "only ${FREE_GB}G free under $MODELS_DIR (need ${MIN_FREE_GB}G) - the 2026-09-21 disk-full stall; free space, then re-run"
fi

# ── acquire ──────────────────────────────────────────────────────────────
if ! timeout 3600 ollama pull "$PULL" >>"$LOG" 2>&1; then
  finish "pull-failed" "ollama pull $PULL failed or exceeded 60 min (see .swarmforge/recruiter/recruiter-weekly.log)"
fi
ollama cp "$PULL" "$ALIAS" >>"$LOG" 2>&1 || finish "alias-failed" "ollama cp $PULL $ALIAS failed"
log "acquired $ALIAS"

# ── register ─────────────────────────────────────────────────────────────
PB="$(echo "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["params_b"])')"
bb "$SCRIPT_DIR/model_steward_cli.bb" register "local/$ALIAS" --cost-class low --context-window 32768 \
   --limitations "recruited from $HF_ID (${PB}B, Q4_K_M) on $STAMP; CPU-only inference on this host" >>"$LOG" 2>&1 \
  || finish "register-failed" "model_steward_cli.bb register local/$ALIAS failed"

# ── benchmark ────────────────────────────────────────────────────────────
CODER_BATTERY="$(cd "$ROOT" && LOCAL_CODER_BATTERY_MODEL="$ALIAS" bash "$SCRIPT_DIR/local_coder_battery.sh" 2>>"$LOG")"
CODER_RESULT="$(echo "$CODER_BATTERY" | sed -n 's/^RESULT=//p')"
SCORECARD_DIR="$ROOT/.swarmforge/model-steward/scorecards"
mkdir -p "$SCORECARD_DIR"
SCORECARD="$SCORECARD_DIR/local__$ALIAS.json"
BATTERY_LOG="$STATE/battery-$STAMP.log"
( cd "$ROOT" && python3 "$SCRIPT_DIR/local_model_compliance_battery.py" "$ALIAS" "$SCORECARD" ) >/dev/null 2>"$BATTERY_LOG" \
  || log "battery exited non-zero (see $BATTERY_LOG)"
[[ -s "$SCORECARD" ]] || finish "battery-failed" "no scorecard written for $ALIAS (see $BATTERY_LOG)"
TALLY="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); e=d["entries"]; print(f"{sum(1 for x in e if x[\"status\"]==\"pass\")}/{len(e)} overall={d.get(\"overall\")}")' "$SCORECARD")"
SAFETY="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(", ".join(f"{x[\"competency\"]}={x[\"status\"]}" for x in d["entries"] if x["competency"].startswith("coordinator-")))' "$SCORECARD")"
BATTERY_SUMMARY="- BL-1127 coder battery: ${CODER_RESULT:-unknown}
- compliance battery: $TALLY
- safety probes: $SAFETY
- scorecard: .swarmforge/model-steward/scorecards/local__$ALIAS.json
- battery log: .swarmforge/recruiter/battery-$STAMP.log"
log "battery $ALIAS: $TALLY; safety: $SAFETY"

# ── certify (the gate decides) ───────────────────────────────────────────
if CERT_OUT="$(bb "$SCRIPT_DIR/model_steward_cli.bb" certify "local/$ALIAS" 2>&1)"; then
  finish "certified" "local/$ALIAS from $HF_ID — battery $TALLY; safety: $SAFETY. Offer only: staff it via a pack conf if wanted."
else
  REASON="$(echo "$CERT_OUT" | sed -n 's/^certify refused: //p' | head -1)"
  # Disk is scarce on this host (the 2026-09-21 stall was a 98%-full model
  # store) and the human ruled (2026-09-21) that an unfit GGUF may be
  # deleted. Only what THIS run pulled is removed - the alias and its
  # hf.co source tag - never any other model. The scorecard and the
  # candidate registry row stay: they are the record of why it was refused.
  if [[ "${RECRUITER_KEEP_UNFIT:-0}" != "1" ]]; then
    ollama rm "$ALIAS" >>"$LOG" 2>&1 || true
    ollama rm "$PULL" >>"$LOG" 2>&1 || true
    log "removed unfit weights: $ALIAS and $PULL (scorecard + registry row kept)"
    REASON="$REASON; weights removed to free disk (RECRUITER_KEEP_UNFIT=1 to keep)"
  fi
  finish "refused" "local/$ALIAS from $HF_ID — $REASON; battery $TALLY"
fi
