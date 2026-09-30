#!/usr/bin/env bash
# BL-1821: weekly recruiter, specifier scout. recruiter_weekly.sh picks ONE
# Hugging Face model and batteries it for the coder role only; this script
# batteries a BATCH of up to N unseen candidates for the specifier seat
# with BL-1819/BL-1820's own specifier battery, re-batteries the model the
# steward currently favours for specifier (the incumbent), and keeps a
# standing score table answering "is it still the best?".
#
#   discover  -> recruiter_hf_discover.py --batch N (rule-based, no LLM),
#                novelty scoped to this scout's OWN seen list (below) -
#                never recruiter_weekly.sh's own seen.jsonl
#   acquire   -> ollama pull hf.co/<org>/<repo>:Q4_K_M, alias <name>:latest,
#                per candidate (skipped entirely in a stub run); each
#                candidate is marked seen BEFORE the pull is attempted
#   battery   -> swarmforge/scripts/local_specifier_battery.py, per
#                candidate AND the incumbent
#   score     -> .swarmforge/recruiter/score-table.json: one row per
#                model batteried, replacing any older row for that model
#   recommend -> the best challenger only when it passes MORE competencies
#                than the incumbent; a tie or a loss keeps the incumbent
#   report    -> backlog/evidence/recruiter-specifier-scout-<stamp>.md +
#                one line to the Operator Telegram topic
#
# What it never does: edit a pack conf, swarmforge.conf or a seat, launch
# a pack, or commit, or read/write the weekly coder path's own seen.jsonl.
# A better challenger is an OFFER for the human.
#
# BL-1821 spec ruling (note 003572, 2026-09-30): novelty is per role -
# .swarmforge/recruiter/seen-specifier.jsonl is this scout's OWN seen
# list, marked before each pull (same mark-before-pull as
# recruiter_weekly.sh), so a failing pull is not retried every week. Its
# batch skips only models on that list; the weekly coder path's own
# seen.jsonl neither limits this scout nor is written by it, so each
# role's recruiter batteries every new model once.
#
# Usage: recruiter_specifier_scout.sh <project-root> [--batch N]
#
# Test-only seams (never for operator use):
#   RECRUITER_SPECIFIER_STUB_DISCOVER_JSON  path to a JSON file already
#     shaped like recruiter_hf_discover.py --batch N's own stdout
#     ({"candidates": [...]});  read in place of a real discovery call.
#   RECRUITER_SPECIFIER_SKIP_PULL=1         skip ollama pull/cp entirely
#     (the battery below is stubbed too in a test, so nothing needs the
#     real weights).
#   RECRUITER_SPECIFIER_INCUMBENT_MODEL     "local/<alias>" to use as the
#     incumbent, in place of a real `model_steward_cli.bb role-matrix
#     specifier` call; empty string means no incumbent row.
#   RECRUITER_SPECIFIER_STUB_ANSWERS_DIR    a directory holding
#     "<alias>.json" per model (challenger alias or the incumbent's own
#     alias) - when a matching file exists, the battery runs with
#     SPECIFIER_BATTERY_PROVIDER=stub and that file as its
#     SPECIFIER_BATTERY_STUB_ANSWERS_JSON; otherwise it runs for real
#     (SPECIFIER_BATTERY_PROVIDER defaults to "ollama").
set -uo pipefail

ROOT="$(cd "${1:?usage: recruiter_specifier_scout.sh <project-root> [--batch N]}" && pwd)"
shift
BATCH=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch) BATCH="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STATE="$ROOT/.swarmforge/recruiter"
LOG="$STATE/recruiter-specifier-scout.log"
OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
EVIDENCE_DIR="$ROOT/backlog/evidence"
REPORT="$EVIDENCE_DIR/recruiter-specifier-scout-$STAMP.md"
SCORE_TABLE="$STATE/score-table.json"
BATTERY="$SCRIPT_DIR/local_specifier_battery.py"
# BL-1821 spec ruling (note 003572, 2026-09-30): novelty is per role - the
# scout's own seen list, never recruiter_weekly.sh's own seen.jsonl (which
# it neither reads nor writes).
SEEN_SPECIFIER="$STATE/seen-specifier.jsonl"
mkdir -p "$STATE" "$EVIDENCE_DIR" "$(dirname "$OUTBOX")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }

notify() {
  python3 - "$OUTBOX" "$1" <<'PY'
import json, sys
open(sys.argv[1], "a").write(json.dumps({"threadId": "OPERATOR", "text": sys.argv[2]}) + "\n")
PY
}

log "=== specifier scout start root=$ROOT batch=$BATCH ==="

# ── discover a batch ────────────────────────────────────────────────────
if [[ -n "${RECRUITER_SPECIFIER_STUB_DISCOVER_JSON:-}" ]]; then
  DISC="$(cat "$RECRUITER_SPECIFIER_STUB_DISCOVER_JSON")"
else
  # RECRUITER_SEEN_FILE points discovery's own novelty check at the
  # scout's seen list instead of its default (the weekly coder path's
  # seen.jsonl) - see recruiter_hf_discover.py's own SEEN_FILENAME.
  DISC="$(RECRUITER_SEEN_FILE="$(basename "$SEEN_SPECIFIER")" python3 "$SCRIPT_DIR/recruiter_hf_discover.py" "$ROOT" --batch "$BATCH" 2>>"$LOG")" || {
    log "discovery failed"; DISC='{"candidates": []}';
  }
fi
# A stubbed discovery source (tests) has no seen-awareness of its own, and
# a live SCAN_LIMIT run can still surface a candidate discover.py already
# passed through before this batch's own novelty check ran - filter here
# too, against the SAME seen-specifier.jsonl, so a candidate already
# marked by an earlier run (mark-before-pull, below) is skipped rather
# than re-batteried.
CANDIDATES_JSON="$(printf '%s' "$DISC" | python3 -c '
import json, sys
d = json.load(sys.stdin)
seen_path, batch = sys.argv[1], int(sys.argv[2])
seen = set()
try:
    with open(seen_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    seen.add(json.loads(line)["hf_id"])
                except Exception:
                    pass
except FileNotFoundError:
    pass
candidates = [c for c in d.get("candidates", []) if c.get("hf_id") not in seen]
print(json.dumps(candidates[:batch]))
' "$SEEN_SPECIFIER" "$BATCH")"
CANDIDATE_COUNT="$(printf '%s' "$CANDIDATES_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
log "discovered $CANDIDATE_COUNT candidate(s) (batch=$BATCH)"

# ── resolve the incumbent ────────────────────────────────────────────────
if [[ -n "${RECRUITER_SPECIFIER_INCUMBENT_MODEL+x}" ]]; then
  INCUMBENT="${RECRUITER_SPECIFIER_INCUMBENT_MODEL}"
else
  INCUMBENT="$(bb "$SCRIPT_DIR/model_steward_cli.bb" role-matrix specifier 2>>"$LOG" \
    | awk '$1 ~ /^local\// {print $1; exit}')"
fi
log "incumbent=${INCUMBENT:-none}"

# ── battery one model, writing a row into ROWS_JSON (a jsonl accumulator
#    file, since bash has no in-process JSON array) ─────────────────────
ROWS_FILE="$(mktemp)"
trap 'rm -f "$ROWS_FILE"' EXIT

battery_one() {
  local model="$1" hf_id="$2" is_incumbent="$3"
  local safe_alias evidence_dir stub_answers provider
  safe_alias="$(printf '%s' "$model" | tr '/:' '__')"
  evidence_dir="$STATE/battery-evidence"
  mkdir -p "$evidence_dir"
  provider="${SPECIFIER_BATTERY_PROVIDER:-ollama}"
  stub_answers=""
  if [[ -n "${RECRUITER_SPECIFIER_STUB_ANSWERS_DIR:-}" && -f "$RECRUITER_SPECIFIER_STUB_ANSWERS_DIR/$safe_alias.json" ]]; then
    provider="stub"
    stub_answers="$RECRUITER_SPECIFIER_STUB_ANSWERS_DIR/$safe_alias.json"
  fi
  local out
  out="$(export SPECIFIER_BATTERY_PROVIDER="$provider"
         export SPECIFIER_BATTERY_MODEL="$model"
         export SPECIFIER_BATTERY_EVIDENCE_DIR="$evidence_dir"
         export SPECIFIER_BATTERY_STUB_ANSWERS_JSON="$stub_answers"
         python3 "$BATTERY" 2>>"$LOG")"
  local ev passed_total passed total
  ev="$(printf '%s' "$out" | sed -n 's/^EVIDENCE=//p')"
  passed_total="$(printf '%s' "$out" | sed -n 's/^PASSED=//p')"
  passed="${passed_total%%/*}"
  total="${passed_total##*/}"
  log "battery model=$model incumbent=$is_incumbent passed=$passed_total evidence=$ev"
  python3 -c '
import json, sys
model, hf_id, is_incumbent, passed, total, evidence, stamp = sys.argv[1:8]
print(json.dumps({
    "role": "specifier",
    "model": model,
    "hf_id": hf_id or None,
    "battery_stamp": stamp,
    "evidence": evidence,
    "passed": int(passed),
    "total": int(total),
    "incumbent": is_incumbent == "1",
    "updated_at": stamp,
}))
' "$model" "$hf_id" "$is_incumbent" "$passed" "$total" "$ev" "$STAMP" >> "$ROWS_FILE"
}

# ── acquire + battery each candidate ─────────────────────────────────────
CAND_COUNT_FOR_LOOP="$CANDIDATE_COUNT"
for (( i = 0; i < CAND_COUNT_FOR_LOOP; i++ )); do
  CAND_JSON="$(printf '%s' "$CANDIDATES_JSON" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[$i]))")"
  HF_ID="$(printf '%s' "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hf_id",""))')"
  PULL="$(printf '%s' "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ollama_pull",""))')"
  ALIAS="$(printf '%s' "$CAND_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("alias",""))')"
  MODEL_ID="local/$ALIAS"
  # Mark seen NOW, before anything can fail (recruiter_weekly.sh's own
  # mark-before-pull convention) - a failing pull must not be re-picked
  # every week, and the same candidate must never ride two runs at once.
  if [[ -n "$HF_ID" ]]; then
    printf '%s\n' "$(python3 -c 'import json,sys; print(json.dumps({"hf_id": sys.argv[1], "alias": sys.argv[2], "stamp": sys.argv[3]}))' "$HF_ID" "$ALIAS" "$STAMP")" >> "$SEEN_SPECIFIER"
  fi
  if [[ "${RECRUITER_SPECIFIER_SKIP_PULL:-0}" != "1" ]]; then
    if ! timeout 3600 ollama pull "$PULL" >>"$LOG" 2>&1; then
      log "pull failed for $PULL - skipping $MODEL_ID"
      continue
    fi
    ollama cp "$PULL" "$ALIAS" >>"$LOG" 2>&1 || { log "alias failed for $ALIAS - skipping"; continue; }
  fi
  battery_one "$MODEL_ID" "$HF_ID" "0"
done

# ── battery the incumbent, if there is one ───────────────────────────────
if [[ -n "$INCUMBENT" ]]; then
  battery_one "$INCUMBENT" "" "1"
fi

# ── merge into the standing score table (replace rows for the same model,
#    never duplicate) ─────────────────────────────────────────────────────
python3 -c '
import json, sys
rows_file, table_path, stamp = sys.argv[1:4]
new_rows = []
with open(rows_file) as f:
    for line in f:
        line = line.strip()
        if line:
            new_rows.append(json.loads(line))
try:
    with open(table_path) as f:
        table = json.load(f)
except Exception:
    table = {"rows": [], "recommend": {}}
existing_rows = table.get("rows", [])
# BL-1821 QA bounce D1: an incumbent change (or a run that batteries none)
# must not leave a stale incumbent flag on an older row for the same role.
# Clear the flag on every existing row of a role this run touched before
# merging in the authoritative flags carried by new_rows.
roles_this_run = {r["role"] for r in new_rows}
for r in existing_rows:
    if r["role"] in roles_this_run:
        r["incumbent"] = False
by_model = {(r["role"], r["model"]): r for r in existing_rows}
for r in new_rows:
    by_model[(r["role"], r["model"])] = r
rows = list(by_model.values())

# recommend, per role: the best non-incumbent row that passes STRICTLY
# more than the incumbent row (a tie or a loss keeps the incumbent).
recommend = table.get("recommend", {})
for role in {r["role"] for r in rows}:
    role_rows = [r for r in rows if r["role"] == role]
    incumbent_row = next((r for r in role_rows if r.get("incumbent")), None)
    challengers = [r for r in role_rows if not r.get("incumbent")]
    best = max(challengers, key=lambda r: r["passed"], default=None)
    if incumbent_row is None:
        if best:
            recommend[role] = "%s as an offer for %s (passed %s/%s, no incumbent on record)" % (
                best["model"], role, best["passed"], best["total"])
        else:
            recommend[role] = "no candidates batteried"
    elif best and best["passed"] > incumbent_row["passed"]:
        recommend[role] = "%s as an offer for %s (passed %s/%s vs incumbent %s %s/%s)" % (
            best["model"], role, best["passed"], best["total"],
            incumbent_row["model"], incumbent_row["passed"], incumbent_row["total"])
    else:
        recommend[role] = "keep the incumbent %s (%s/%s)" % (
            incumbent_row["model"], incumbent_row["passed"], incumbent_row["total"])

table["rows"] = rows
table["recommend"] = recommend
table["updated_at"] = stamp
with open(table_path, "w") as f:
    json.dump(table, f, indent=2)
    f.write("\n")
' "$ROWS_FILE" "$SCORE_TABLE" "$STAMP"

RECOMMEND_LINE="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("recommend",{}).get("specifier","no recommendation"))' "$SCORE_TABLE")"

{
  echo "# Recruiter specifier scout — $STAMP"
  echo
  echo "- stamped: $STAMP"
  echo "- batch: $BATCH"
  echo "- candidates batteried: $CAND_COUNT_FOR_LOOP"
  echo "- incumbent: ${INCUMBENT:-none}"
  echo "- recommend: $RECOMMEND_LINE"
  echo
  echo "Recruiter finds, Steward judges: a better challenger is an offer, never a"
  echo "staffing change. Score table: .swarmforge/recruiter/score-table.json"
} > "$REPORT"
log "report=$REPORT recommend=$RECOMMEND_LINE"
notify "🧭 Specifier scout: $RECOMMEND_LINE (report: backlog/evidence/$(basename "$REPORT"))"

exit 0
