#!/usr/bin/env bash
# BL-1238 acceptance driver: invokes the REAL idle_clear_fullness_cli.bb
# should-respawn? (never a reimplementation) against a real fixture -
# real roles.tsv (BL-089 opt-in column), an optional .vscode/settings.json
# threshold override, and a fake tmux binary whose capture-pane output
# controls the proxy-fullness line count deterministically.
#
# Usage: bl1238IdleClearFullnessCli.sh <optin:on|off> <threshold:NN|default> <fullness:NN|unavailable>
# Prints one JSON line: {"respawn":bool}

set -uo pipefail

OPTIN="$1"
THRESHOLD="$2"
FULLNESS="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CLI_BB="$SCRIPT_DIR/swarmforge/scripts/idle_clear_fullness_cli.bb"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

mkdir -p "$ROOT/.swarmforge"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\t%s\n' "$ROOT" "$OPTIN" \
  > "$ROOT/.swarmforge/roles.tsv"

if [[ "$THRESHOLD" != "default" ]]; then
  mkdir -p "$ROOT/.vscode"
  printf '{"swarmforge.contextClear.fullnessThresholdPercent": %s}\n' "$THRESHOLD" \
    > "$ROOT/.vscode/settings.json"
fi

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"

if [[ "$FULLNESS" == "unavailable" ]]; then
  # No TMUX_PANE set at all -> read-context-fullness's own :unavailable path.
  unset TMUX_PANE 2>/dev/null || true
else
  # Fake tmux prints exactly the number of lines needed so
  # (lines / proxy-full-at-line-count) * 100 == FULLNESS, for the proxy
  # calibration idle_clear_fullness_cli.bb itself declares (400 lines full).
  LINES=$(( FULLNESS * 4 ))
  cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
for i in \$(seq 1 $LINES); do echo "line \$i"; done
exit 0
TMUX
  chmod +x "$FAKE_BIN/tmux"
  export TMUX_PANE="%1"
fi

touch "$ROOT/.swarmforge/tmux-socket"

RESPAWN="$(
  cd "$ROOT"
  PATH="$FAKE_BIN:$PATH" bb -e '
    (load-file "'"$CLI_BB"'")
    (handoff-lib/set-project-root! "'"$ROOT"'")
    (println (idle-clear-fullness-cli/should-respawn? "coder"))
  ' 2>/dev/null
)"

case "$RESPAWN" in
  true) printf '{"respawn":true}\n' ;;
  false) printf '{"respawn":false}\n' ;;
  *) printf '{"respawn":null,"raw":%s}\n' "$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$RESPAWN")" ;;
esac
