#!/usr/bin/env bash
# BL-1381 acceptance fixture: drive the REAL shift schedule applier lib, the
# REAL install wrapper and the REAL BL-660 runner over a fixture project root.
#
# Usage: bl1381ShiftScheduleCli.sh <work-dir> <shape>
#   shapes:
#     lib-loads          load the lib with bb, and run the BL-660 unit runner
#     configured-shift   swarm_shift=day, one foreign crontab line present,
#                        install through the live reconcile path
#     governor-present   the budget governor CLI exists and prints a pass
#     governor-absent    the budget governor CLI does not exist
#     reconcile-empty    the reconcile exits NON-ZERO printing nothing
#     reconcile-notjson  the reconcile exits ZERO printing text that is not JSON
#
# Prints one JSON line:
#   {"exit":N,"out":"...","cronBefore":"...","cronAfter":"...","verdict":...}
#
# The crontab is ALWAYS a fixture file behind a shim on PATH. Nothing here
# reads or writes the live user crontab - the ticket requires that explicitly,
# and the scripts under test are the ones that install into a real crontab.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"
LIB="$SCRIPTS/shift_schedule_applier_lib.bb"
INSTALL="$SCRIPTS/install_shift_schedule_cron.sh"
RUNNER="$SCRIPTS/test/swarm_shift_lib_test_runner.bb"

ROOT="$WORK/root"
mkdir -p "$ROOT/swarmforge" "$WORK/bin"

# The fixture crontab, and a shim that reads and writes only it.
CRON="$WORK/crontab.txt"
printf '# a line that is not the swarm-s\n0 12 * * * /usr/bin/true\n' >"$CRON"
cat >"$WORK/bin/crontab" <<'SHIM'
#!/usr/bin/env bash
case "${1:-}" in
  -l) cat "$BL1381_CRON" ;;
  -r) : >"$BL1381_CRON" ;;
  -)  cat >"$BL1381_CRON" ;;
  *)  exit 2 ;;
esac
SHIM
chmod +x "$WORK/bin/crontab"

CRON_BEFORE="$(cat "$CRON")"
OUT=""
CODE=0
VERDICT="null"

case "$SHAPE" in
  lib-loads)
    OUT="$(bb -e "(load-file \"$LIB\") (println \"LOADED\")" 2>&1)"
    CODE=$?
    if [[ "$CODE" -eq 0 ]]; then
      RUNNER_OUT="$(bb "$RUNNER" 2>&1)"
      RUNNER_CODE=$?
      OUT="$OUT
runner-exit=$RUNNER_CODE
$RUNNER_OUT"
      CODE=$RUNNER_CODE
    fi
    ;;

  configured-shift)
    # The real key, read off legacy_operator_schedule_lib.bb's own regex
    # (^config\s+swarm_shift\s+(\S+)) rather than guessed at.
    printf 'config swarm_shift day\n' >"$ROOT/swarmforge/swarmforge.conf"
    OUT="$(BL1381_CRON="$CRON" PATH="$WORK/bin:$PATH" bash "$INSTALL" "$ROOT" 2>&1)"
    CODE=$?
    ;;

  governor-present|governor-absent)
    if [[ "$SHAPE" == "governor-present" ]]; then
      mkdir -p "$ROOT/extension/out/tools"
      printf "console.log(JSON.stringify({verdict:'pass'}));\n" \
        >"$ROOT/extension/out/tools/budget-shift-governor.js"
    fi
    VERDICT="$(BL1381_LIB="$LIB" BL1381_ROOT="$ROOT" bb -e '
(load-file (System/getenv "BL1381_LIB"))
(require (quote [cheshire.core :as json]))
(println (json/generate-string
          {:verdict (shift-schedule-applier-lib/budgetShiftGovernorVerdict
                     (System/getenv "BL1381_ROOT") 1234)}))' 2>&1 | tail -1)"
    CODE=0
    OUT="$VERDICT"
    ;;

  reconcile-empty|reconcile-notjson)
    # Injected through the wrapper's own reconcile-path seam: this overrides
    # WHICH program runs, never what verdict the wrapper reaches.
    if [[ "$SHAPE" == "reconcile-empty" ]]; then
      printf '#!/usr/bin/env bb\n(System/exit 3)\n' >"$WORK/stub.bb"
    else
      printf '#!/usr/bin/env bb\n(println "not json at all")\n(System/exit 0)\n' >"$WORK/stub.bb"
    fi
    OUT="$(BL1381_CRON="$CRON" PATH="$WORK/bin:$PATH" \
      SHIFT_SCHEDULE_RECONCILE_BB="$WORK/stub.bb" bash "$INSTALL" "$ROOT" 2>&1)"
    CODE=$?
    ;;

  *) echo "unknown shape: $SHAPE" >&2; exit 2 ;;
esac

CRON_AFTER="$(cat "$CRON")"

BL_OUT="$OUT" BL_CODE="$CODE" BL_B="$CRON_BEFORE" BL_A="$CRON_AFTER" BL_V="$VERDICT" \
  python3 -c 'import json, os; print(json.dumps({
    "exit": int(os.environ["BL_CODE"]),
    "out": os.environ["BL_OUT"],
    "cronBefore": os.environ["BL_B"],
    "cronAfter": os.environ["BL_A"],
    "verdictRaw": os.environ["BL_V"],
}))'
