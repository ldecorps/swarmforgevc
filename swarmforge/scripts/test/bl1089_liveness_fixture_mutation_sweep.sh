#!/usr/bin/env bash
# BL-1089 hardender: surgical mutation sweep over the repaired liveness
# fixture, the shared pollHeartbeatStale adapter, and the APS step handlers.
#
# Why hand-authored: Stryker mutates extension/out only (no parcel TS src).
# The feature has plain Scenario: rows only — Gherkin mutation is
# outcome:inapplicable (BL-638), so it cannot stand in for this gate.
# Each mutant is a single edit a correct suite MUST reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

FIXTURE=swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh
ADAPTER=specs/pipeline/steps/lib/pollHeartbeatStale.js
STEPS=specs/pipeline/steps/bl1089FrontDeskLivenessSuiteSteps.js
FEATURE=specs/features/BL-1089-the-front-desk-liveness-suite-gates-the-guarantee-it-names.feature
ANCHORS="$(mktemp)"

ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")
LIVENESS=(bash "$FIXTURE")

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

BACKUP_F="$(mktemp)"; BACKUP_A="$(mktemp)"; BACKUP_S="$(mktemp)"
cp "$FIXTURE" "$BACKUP_F"
cp "$ADAPTER" "$BACKUP_A"
cp "$STEPS" "$BACKUP_S"
restore() {
  cp "$BACKUP_F" "$FIXTURE"
  cp "$BACKUP_A" "$ADAPTER"
  cp "$BACKUP_S" "$STEPS"
}
cleanup() { restore; rm -f "$BACKUP_F" "$BACKUP_A" "$BACKUP_S" "$ANCHORS"; }
trap cleanup EXIT

# Anchors as JSON (avoids bash $(…) quoting traps on multiline fragments).
python3 - "$ANCHORS" <<'PY'
import json, sys
anchors = [
  {
    "file": "swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh",
    "label": "fixture: age-0 -> 5000 (predecessor-shaped)",
    "from": 'write_heartbeat "$root" 0',
    "to": 'write_heartbeat "$root" 5000',
    "killers": ["prop", "liveness"],
  },
  {
    "file": "swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh",
    "label": "fixture: first stall path uses 5000 backdate",
    "from": 'stamp_own_heartbeat_then_age_past_stall "$F"\ncheck_once "$F" > /dev/null\ncheck "front-desk-liveness-01:',
    "to": 'write_heartbeat "$F" 5000\ncheck_once "$F" > /dev/null\ncheck "front-desk-liveness-01:',
    "killers": ["prop", "liveness"],
  },
  {
    "file": "swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh",
    "label": "fixture: predecessor pin expects stalled",
    "from": 'check "bl-1089: a predecessor heartbeat inside startup grace is not declared stalled" \\\n  \'[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]\'',
    "to": 'check "bl-1089: a predecessor heartbeat inside startup grace is not declared stalled" \\\n  \'[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == stalled ]]\'',
    "killers": ["liveness"],
  },
  {
    "file": "swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh",
    "label": "fixture: stall check label emptied (APS loses its bite)",
    "from": "front-desk-liveness-01: a stopped-listening bot is reported as stalled, never plain 'running'",
    "to": "front-desk-liveness-01: a stopped-listening bot is reported as stalled, never plain 'running-MUTATED'",
    "killers": ["accept"],
  },
  {
    "file": "specs/pipeline/steps/lib/pollHeartbeatStale.js",
    "label": "adapter: invert true/false compare",
    "from": "return out.trim() === 'true';",
    "to": "return out.trim() === 'false';",
    "killers": ["prop", "accept"],
  },
  {
    "file": "specs/pipeline/steps/lib/pollHeartbeatStale.js",
    "label": "adapter: always stale",
    "from": "return out.trim() === 'true';",
    "to": "return true;",
    "killers": ["prop", "accept"],
  },
  {
    "file": "specs/pipeline/steps/lib/pollHeartbeatStale.js",
    "label": "adapter: never stale",
    "from": "return out.trim() === 'true';",
    "to": "return false;",
    "killers": ["prop", "accept"],
  },
  {
    "file": "specs/pipeline/steps/lib/pollHeartbeatStale.js",
    "label": "adapter: drop 5-arity spawn/grace from bb form",
    "from": "(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${stall} ${spawn} ${grace}))",
    "to": "(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${stall}))",
    "killers": ["prop", "accept"],
  },
  {
    "file": "specs/pipeline/steps/bl1089FrontDeskLivenessSuiteSteps.js",
    "label": "steps: stalled assert flipped",
    "from": "assert.equal(ctx.verdict, true, 'predicate must report stalled');",
    "to": "assert.equal(ctx.verdict, false, 'predicate must report stalled');",
    "killers": ["accept"],
  },
  {
    "file": "specs/pipeline/steps/bl1089FrontDeskLivenessSuiteSteps.js",
    "label": "steps: not-stalled assert flipped",
    "from": "assert.equal(ctx.verdict, false, 'predicate must report not stalled');",
    "to": "assert.equal(ctx.verdict, true, 'predicate must report not stalled');",
    "killers": ["accept"],
  },
  {
    "file": "specs/pipeline/steps/bl1089FrontDeskLivenessSuiteSteps.js",
    "label": "steps: grace-passed now stays inside grace",
    "from": "ctx.now = SPAWN_AT + GRACE_MS + 1;",
    "to": "ctx.now = SPAWN_AT + Math.floor(GRACE_MS / 2);",
    "killers": ["accept"],
  },
  {
    "file": "specs/pipeline/steps/bl1089FrontDeskLivenessSuiteSteps.js",
    "label": "steps: predecessor hb moved after spawn",
    "from": "ctx.heartbeat = SPAWN_AT - STALL_MS - 1;",
    "to": "ctx.heartbeat = SPAWN_AT + STALL_MS + 1;",
    "killers": ["accept"],
  },
]
open(sys.argv[1], "w").write(json.dumps(anchors))
PY

run_prop() {
  (cd extension && npx vitest run --config vitest.properties.config.mjs \
    test/bl1089FrontDeskLivenessFixture.property.test.js) >/dev/null 2>&1
}

kill_with() {
  local k="$1"
  case "$k" in
    prop) run_prop ;;
    accept) "${ACCEPT[@]}" >/dev/null 2>&1 ;;
    liveness) "${LIVENESS[@]}" >/dev/null 2>&1 ;;
    *) return 2 ;;
  esac
}

echo "mutation sweep over BL-1089 fixture + adapter + steps"

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
    kill_with "$k"
    rc=$?
    if [[ "$rc" -eq 2 ]]; then
      echo "  skip     $label (unknown killer $k)"
      skipped=$((skipped + 1))
      dead=-1
      break
    fi
    if [[ "$rc" -ne 0 ]]; then
      echo "  killed   $label ($k)"
      killed=$((killed + 1))
      dead=1
      break
    fi
  done
  if [[ "$dead" -eq 0 ]]; then
    echo "  SURVIVED $label"
    SURVIVORS+=("$label")
    survived=$((survived + 1))
  fi
done < <(python3 -c 'import json,sys; [print(json.dumps(a)) for a in json.load(open(sys.argv[1]))]' "$ANCHORS")

echo
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$skipped" -gt 0 ]]; then
  echo "FAIL: skipped>0 — stale anchors, not a pass (BL-1101 discipline)"
  exit 1
fi
if [[ "${#SURVIVORS[@]}" -gt 0 ]]; then
  echo "SURVIVORS:"
  printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
echo "ALL MUTANTS KILLED"
