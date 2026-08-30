#!/usr/bin/env bash
# BL-1182: drives the REAL model_steward_cli.bb trial lifecycle end to end
# against an isolated state dir - nominate, seat, assess, promote, revert, and
# the refusals that keep the loop honest. The pure decisions are covered by
# model_steward_trial_lib_test_runner.bb; what this proves is that the CLI
# persists trial state, moves the SEAT, and runs the memory boundary.
#
# The memory boundary is a stub tool here (MODEL_STEWARD_MEMORY_TOOL), not the
# real capture: this test is about the lifecycle honouring the boundary's exit
# status, and a live capture would drag a whole tmux/agent surface into a shell
# test. That the real tool composes BL-1178's API is its own unit test's job.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../model_steward_cli.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

WORK="$(mktemp -d)"
register_tmp_dir "$WORK"
export MODEL_STEWARD_STATE_DIR="$WORK/steward"
export MODEL_FACTORY_STATE_DIR="$WORK/factory"
mkdir -p "$MODEL_STEWARD_STATE_DIR" "$MODEL_FACTORY_STATE_DIR"

# A memory-boundary stub that records every call and succeeds.
CALLS="$WORK/memory-calls"
: > "$CALLS"
cat > "$WORK/memory-ok.js" <<'STUB'
const fs = require('fs');
fs.appendFileSync(process.env.BL1182_CALLS, process.argv.slice(2).join(' ') + '\n');
process.stdout.write(JSON.stringify({ ok: true }) + '\n');
STUB
cat > "$WORK/memory-fail.js" <<'STUB'
process.stdout.write(JSON.stringify({ ok: false, signal: 'inject refused' }) + '\n');
process.exit(1);
STUB
export BL1182_CALLS="$CALLS"
export MODEL_STEWARD_MEMORY_TOOL="$WORK/memory-ok.js"

seed_registry() {
  # perm scores 7, trial scores $1, trial cost class $2.
  rm -f "$MODEL_STEWARD_STATE_DIR/registry.json" "$MODEL_STEWARD_STATE_DIR/trials.json"
  bb "$CLI" register anthropic/perm-model --status certified --cost-class medium >/dev/null
  bb "$CLI" register cerebras/trial-model --status certified --cost-class "$2" >/dev/null
  bb -e "
(require '[cheshire.core :as json])
(let [p (str (System/getenv \"MODEL_STEWARD_STATE_DIR\") \"/registry.json\")
      reg (json/parse-string (slurp p) true)]
  (spit p (json/generate-string
           (assoc-in reg [:role_matrix :coder]
                     [{:provider \"anthropic\" :model \"perm-model\" :score 7 :evidence \"scorecard: perm\"}
                      {:provider \"cerebras\" :model \"trial-model\" :score $1 :evidence \"scorecard: trial\"}]))))
" >/dev/null
  # The role's SEAT is what a trial displaces, so the fixture seats the
  # permanent model rather than leaving the CLI to guess one.
  printf '%s\n' '{"coder":{"role":"coder","provider":"anthropic","model":"perm-model","agent":"claude"}}' \
    > "$MODEL_FACTORY_STATE_DIR/assignment.json"
}

seat_model() {
  bb -e "
(require '[cheshire.core :as json])
(let [p (str (System/getenv \"MODEL_FACTORY_STATE_DIR\") \"/assignment.json\")]
  (if (.exists (java.io.File. p))
    (println (get-in (json/parse-string (slurp p) true) [:coder :model]))
    (println \"NONE\")))
"
}

# ── 01: nomination arms a one-day trial and moves the seat ─────────────────
seed_registry 9 high
out="$(bb "$CLI" trial nominate cerebras/trial-model --role coder 2>&1)"
check "01: nomination reports the armed trial" '[[ "$out" == *"trial armed role=coder"* ]]'
check "01: the trial window is recorded" '[[ "$out" == *"ends="* ]]'
check "01: the seat now runs the trial model" '[[ "$(seat_model)" == "trial-model" ]]'
check "01: trial status reports the armed trial" '[[ "$(bb "$CLI" trial status --role coder)" == *"armed cerebras/trial-model"* ]]'
check "01: the start boundary ran a memory transfer" 'grep -q -- "--boundary start" "$CALLS"'

# ── 02: an outranking trial promotes and keeps the seat ────────────────────
out="$(bb "$CLI" trial assess --role coder 2>&1)"
check "02: an outranking trial promotes" '[[ "$out" == *"trial promote role=coder"* ]]'
check "02: the trialled model is permanent" '[[ "$out" == *"permanent=cerebras/trial-model"* ]]'
check "02: the seat still runs the trialled model" '[[ "$(seat_model)" == "trial-model" ]]'
check "02: a promotion changes no model, so it owes no end transfer" '[[ "$(grep -c -- "--boundary end" "$CALLS")" == "0" ]]'
check "02: the armed trial is gone" '[[ "$(bb "$CLI" trial status --role coder)" == *"no armed trial"* ]]'

# ── 03: a tie goes to the cheaper cost class ───────────────────────────────
: > "$CALLS"
seed_registry 7 low
bb "$CLI" trial nominate cerebras/trial-model --role coder >/dev/null 2>&1
out="$(bb "$CLI" trial assess --role coder 2>&1)"
check "03: a tie promotes the cheaper model" '[[ "$out" == *"trial promote role=coder"* ]]'
check "03: the reason names the tie and the cost class" '[[ "$out" == *"tie at"* && "$out" == *"cheaper"* ]]'

# ── 04: a losing trial reverts, records evidence, and refuses a silent re-trial ──
: > "$CALLS"
seed_registry 3 low
bb "$CLI" trial nominate cerebras/trial-model --role coder --evidence scorecards/first.json >/dev/null 2>&1
out="$(bb "$CLI" trial assess --role coder 2>&1)"
check "04: a losing trial reverts" '[[ "$out" == *"trial revert role=coder"* ]]'
check "04: the seat returns to the permanent model" '[[ "$(seat_model)" == "perm-model" ]]'
check "04: the end boundary ran a memory transfer" 'grep -q -- "--boundary end" "$CALLS"'
retry="$(bb "$CLI" trial nominate cerebras/trial-model --role coder --evidence scorecards/first.json 2>&1)"
check "04: re-trial on the same evidence is refused" '[[ "$retry" == *"already lost a trial"* ]]'
fresh="$(bb "$CLI" trial nominate cerebras/trial-model --role coder --evidence scorecards/second.json 2>&1)"
check "04: re-trial on new evidence is allowed" '[[ "$fresh" == *"trial armed role=coder"* ]]'

# ── 05: a failed memory transfer aborts the switch, seat untouched ─────────
seed_registry 9 high
before="$(seat_model)"
export MODEL_STEWARD_MEMORY_TOOL="$WORK/memory-fail.js"
out="$(bb "$CLI" trial nominate cerebras/trial-model --role coder 2>&1)"
check "05: a failed transfer refuses the nomination" '[[ "$out" == *"agent-memory transfer failed"* ]]'
check "05: the refusal says the seat was not moved" '[[ "$out" == *"seat was NOT moved"* ]]'
check "05: the seat is unchanged" '[[ "$(seat_model)" == "$before" ]]'
check "05: no trial was armed" '[[ "$(bb "$CLI" trial status --role coder)" == *"no armed trial"* ]]'
export MODEL_STEWARD_MEMORY_TOOL="$WORK/memory-ok.js"

if [[ $fail -eq 0 ]]; then
  note "model_steward trial lifecycle (BL-1182): ALL CHECKS PASSED"
else
  note "model_steward trial lifecycle (BL-1182): FAILURES"
fi
exit $fail
