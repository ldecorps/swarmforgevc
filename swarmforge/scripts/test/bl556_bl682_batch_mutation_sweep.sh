#!/usr/bin/env bash
# BL-556 / BL-682 hardener batch: surgical mutation over new babashka libs
# and APS step handlers. Stryker cannot see .bb; shared factory/cli/store
# files are BL-149 skip-cooldown this pass — mutate only DECISION:run surfaces.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

EVAL_LIB=swarmforge/scripts/model_steward_evaluate_lib.bb
MISTRAL_LIB=swarmforge/scripts/mistral_vibe_registration_lib.bb
STEPS_556=specs/pipeline/steps/bl556EvaluateIngestSteps.js
STEPS_682=specs/pipeline/steps/bl682MistralVibeRoutingSteps.js
FEATURE_556=specs/features/BL-556-model-steward-slice2-evaluate-ingestion.feature
FEATURE_682=specs/features/BL-682-mistral-vibe-intelligence-layer-routing.feature

UNIT_556=(bb swarmforge/scripts/test/bl556_evaluate_ingest_test_runner.bb)
UNIT_682=(bb swarmforge/scripts/test/bl682_mistral_vibe_routing_test_runner.bb)
PROP_556=(bash -c 'cd extension && npx vitest run --config vitest.properties.config.mjs test/bl556EvaluateIngest.property.test.js')
PROP_682=(bash -c 'cd extension && npx vitest run --config vitest.properties.config.mjs test/bl682MistralVibeRouting.property.test.js')
ACCEPT_556=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE_556")
ACCEPT_682=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE_682")

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
ANCHORS="$(mktemp)"
B_EVAL="$(mktemp)"; B_MIS="$(mktemp)"; B_S556="$(mktemp)"; B_S682="$(mktemp)"
cp "$EVAL_LIB" "$B_EVAL"; cp "$MISTRAL_LIB" "$B_MIS"
cp "$STEPS_556" "$B_S556"; cp "$STEPS_682" "$B_S682"
restore() {
  cp "$B_EVAL" "$EVAL_LIB"; cp "$B_MIS" "$MISTRAL_LIB"
  cp "$B_S556" "$STEPS_556"; cp "$B_S682" "$STEPS_682"
}
cleanup() { restore; rm -f "$B_EVAL" "$B_MIS" "$B_S556" "$B_S682" "$ANCHORS"; }
trap cleanup EXIT

python3 - "$ANCHORS" <<'PY'
import json, sys
anchors = [
  # ── BL-556 evaluate lib ──────────────────────────────────────────────────
  {"file": "swarmforge/scripts/model_steward_evaluate_lib.bb",
   "label": "556: invent scorecard id when missing",
   "from": '(throw (ex-info (str "evaluate refused: captured " label " missing " (name id-key))\n                       {:keys (keys artifact)})))\n    (str id)))',
   "to": '(str (or id (str "invented-" (name id-key))))))',
   "killers": ["unit556", "prop556"]},
  {"file": "swarmforge/scripts/model_steward_evaluate_lib.bb",
   "label": "556: regression-diff only fail→pass",
   "from": ':when (and pg (:passed? pg) (not (:passed? cg)))]',
   "to": ':when (and pg (not (:passed? pg)) (:passed? cg))]',
   "killers": ["unit556", "prop556"]},
  {"file": "swarmforge/scripts/model_steward_evaluate_lib.bb",
   "label": "556: evidence drops bakeoff join",
   "from": '(if bakeoff-run-id\n    (str scorecard-id "+" bakeoff-run-id)\n    scorecard-id)',
   "to": 'scorecard-id',
   "killers": ["unit556"]},
  {"file": "swarmforge/scripts/model_steward_evaluate_lib.bb",
   "label": "556: always report certified (ignore regressions)",
   "from": ':result (if (seq regressions) "regressed" "certified")',
   "to": ':result "certified"',
   "killers": ["unit556", "accept556"]},
  {"file": "swarmforge/scripts/model_steward_evaluate_lib.bb",
   "label": "556: pass-rate always 1.0",
   "from": '(double (/ (count (filter entry-passed? entries)) (count entries)))',
   "to": '1.0',
   "killers": ["unit556"]},
  # ── BL-682 mistral registration lib ──────────────────────────────────────
  {"file": "swarmforge/scripts/mistral_vibe_registration_lib.bb",
   "label": "682: invent mistral-vibe id when config absent",
   "from": '(agent-granularity "vibe config absent: no model id the tool could supply")',
   "to": '{:provider mistral-provider :model "mistral-vibe" :status "candidate" :trace "invented"}',
   "killers": ["unit682", "prop682"]},
  {"file": "swarmforge/scripts/mistral_vibe_registration_lib.bb",
   "label": "682: register rolling latest name as id",
   "from": ':model alias',
   "to": ':model name',
   "killers": ["unit682", "prop682"]},
  {"file": "swarmforge/scripts/mistral_vibe_registration_lib.bb",
   "label": "682: cost bands flipped (medium→low floor)",
   "from": '(< total 1.0) "low"\n      (< total 20.0) "medium"',
   "to": '(< total 20.0) "low"\n      (< total 100.0) "medium"',
   "killers": ["unit682"]},
  {"file": "swarmforge/scripts/mistral_vibe_registration_lib.bb",
   "label": "682: some→every (no match short-circuit)",
   "from": '(some (fn [row]',
   "to": '(every? (fn [row]',
   "killers": ["unit682", "prop682"]},
  {"file": "swarmforge/scripts/mistral_vibe_registration_lib.bb",
   "label": "682: agent-granularity model becomes mistral",
   "from": '(def agent-granularity-model vibe-agent)',
   "to": '(def agent-granularity-model mistral-provider)',
   "killers": ["unit682"]},
  # ── APS steps ────────────────────────────────────────────────────────────
  {"file": "specs/pipeline/steps/bl556EvaluateIngestSteps.js",
   "label": "556-steps: regressed result assert flipped",
   "from": "assert.equal(report.result, 'regressed');",
   "to": "assert.equal(report.result, 'certified');",
   "killers": ["accept556"]},
  {"file": "specs/pipeline/steps/bl682MistralVibeRoutingSteps.js",
   "label": "682-steps: mistral resolves to aider",
   "from": "assert.equal(agentFor('mistral'), 'vibe');",
   "to": "assert.equal(agentFor('mistral'), 'aider');",
   "killers": ["accept682"]},
]
open(sys.argv[1], "w").write(json.dumps(anchors))
PY

kill_with() {
  case "$1" in
    unit556) "${UNIT_556[@]}" >/dev/null 2>&1 ;;
    unit682) "${UNIT_682[@]}" >/dev/null 2>&1 ;;
    prop556) "${PROP_556[@]}" >/dev/null 2>&1 ;;
    prop682) "${PROP_682[@]}" >/dev/null 2>&1 ;;
    accept556) "${ACCEPT_556[@]}" >/dev/null 2>&1 ;;
    accept682) "${ACCEPT_682[@]}" >/dev/null 2>&1 ;;
    *) return 2 ;;
  esac
}

echo "mutation sweep over BL-556/BL-682 evaluate + mistral registration"

while IFS= read -r row; do
  restore
  label="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["label"])' "$row")"
  if ! python3 - "$row" <<'PY'
import json, sys
row = json.loads(sys.argv[1])
path, a, b = row["file"], row["from"], row["to"]
s = open(path).read()
if a not in s:
    sys.exit(3)
open(path, "w").write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    skipped=$((skipped + 1))
    continue
  fi
  killers="$(python3 -c 'import json,sys; print(" ".join(json.loads(sys.argv[1])["killers"]))' "$row")"
  dead=0
  for k in $killers; do
    kill_with "$k"; rc=$?
    if [[ "$rc" -eq 2 ]]; then
      echo "  skip     $label (unknown killer $k)"; skipped=$((skipped + 1)); dead=-1; break
    fi
    if [[ "$rc" -ne 0 ]]; then
      echo "  killed   $label ($k)"; killed=$((killed + 1)); dead=1; break
    fi
  done
  if [[ "$dead" -eq 0 ]]; then
    echo "  SURVIVED $label"; SURVIVORS+=("$label"); survived=$((survived + 1))
  fi
done < <(python3 -c 'import json,sys; [print(json.dumps(a)) for a in json.load(open(sys.argv[1]))]' "$ANCHORS")

echo
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$skipped" -gt 0 ]]; then
  echo "FAIL: skipped>0"; exit 1
fi
if [[ "${#SURVIVORS[@]}" -gt 0 ]]; then
  printf 'SURVIVORS:\n  %s\n' "${SURVIVORS[@]}"; exit 1
fi
echo "ALL MUTANTS KILLED"
