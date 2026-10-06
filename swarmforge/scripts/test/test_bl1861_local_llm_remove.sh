#!/usr/bin/env bash
# BL-1861: drives the REAL local_llm.sh (-> local_llm_cli.bb) against a
# REAL private tmux server (BL-1390 proof posture) and a stub Ollama HTTP
# server (node, same style as test_local_model_window_gate_cli.sh), one
# self-contained fixture per scenario since each needs a different model-
# server/roster starting state. A stub `nvidia-smi` on PATH proves the GPU
# memory line actually reads a real command rather than always printing
# "unknown".
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_LLM="$SCRIPT_DIR/../local_llm.sh"
MODEL="qwen2.5-coder-14b-q5km:latest"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Fast bounds for every fixture - scenario 06 needs this to actually time
# out in test time, and the others succeed on the first poll anyway.
export SWARMFORGE_LOCAL_LLM_UNLOAD_WAIT_SECONDS=2
export SWARMFORGE_LOCAL_LLM_UNLOAD_POLL_MS=200

BIN_DIR="$(mktemp -d)"
register_tmp_dir "$BIN_DIR"
cat > "$BIN_DIR/nvidia-smi" <<'EOF'
#!/usr/bin/env bash
echo "4096"
EOF
chmod +x "$BIN_DIR/nvidia-smi"
export PATH="$BIN_DIR:$PATH"

STUB_JS="$BIN_DIR/stub-ollama.js"
cat > "$STUB_JS" <<'EOF'
const http = require('http');
const port = Number(process.env.FAKE_PORT);
let loaded = new Set((process.env.FAKE_LOADED || '').split(',').filter(Boolean));
const stuck = process.env.FAKE_STUCK_MODEL || '';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/ps' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [...loaded].map((name) => ({ name, size: 999, size_vram: 13364000000 })) }));
      return;
    }
    if (req.url === '/api/generate' && req.method === 'POST') {
      let model;
      try { model = JSON.parse(body).model; } catch (e) { /* ignore */ }
      if (model && model !== stuck) loaded.delete(model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ done: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `unknown path ${req.url}` }));
  });
});
server.listen(port, '127.0.0.1');
EOF

declare -a OPEN_SOCKS=()
declare -a FAKE_PIDS=()
cleanup_all() {
  for pid in ${FAKE_PIDS[@]+"${FAKE_PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for s in ${OPEN_SOCKS[@]+"${OPEN_SOCKS[@]}"}; do tmux -S "$s" kill-server 2>/dev/null || true; done
}
trap 'cleanup_all; __swarmforge_cleanup_tmp_dirs' EXIT

start_stub_ollama() {
  local port="$1" loaded_csv="${2:-}" stuck_model="${3:-}"
  FAKE_PORT="$port" FAKE_LOADED="$loaded_csv" FAKE_STUCK_MODEL="$stuck_model" node "$STUB_JS" &
  FAKE_PIDS+=("$!")
  sleep 0.3
}

random_port() { echo $(( (RANDOM % 20000) + 20000 )); }

# Builds a fresh fixture root with a private tmux server, roster listing
# coder/cleaner/coordinator (claude) plus coder@2/coder@iq3 (local-model,
# each with its own launch script naming $MODEL on the given port, unless
# make_local_rows=0 - scenario 03 row 2 and 05 need roster variants).
declare ROOT SOCK WT_CODER WT_CLEANER WT_COORD WT_CODER2 WT_IQ3 PORT

make_fixture() {
  local make_local_rows="${1:-1}" bare_seat="${2:-}"
  ROOT="$(mktemp -d)"
  register_tmp_dir "$ROOT"
  SOCK="$ROOT/private.sock"
  OPEN_SOCKS+=("$SOCK")
  unset TMUX 2>/dev/null || true

  WT_CODER="$ROOT/wt-coder"
  WT_CLEANER="$ROOT/wt-cleaner"
  WT_COORD="$ROOT"
  WT_CODER2="$ROOT/wt-coder2"
  WT_IQ3="$ROOT/wt-coder-iq3"
  mkdir -p "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/local-llm" \
    "$WT_CODER/.swarmforge" "$WT_CLEANER/.swarmforge" \
    "$WT_CODER2/.swarmforge/handoffs/inbox/new" "$WT_CODER2/.swarmforge/handoffs/inbox/in_process" \
    "$WT_IQ3/.swarmforge"
  echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

  PORT="$(random_port)"

  write_roles() {
    local dest="$1"
    printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\toff\tforward-only\n' "$WT_CODER" > "$dest"
    printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\toff\tforward-only\n' "$WT_CLEANER" >> "$dest"
    printf 'coordinator\tcoordinator\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff\tforward-only\n' "$WT_COORD" >> "$dest"
    if [[ "$make_local_rows" == 1 ]]; then
      printf 'coder@2\tcoder\t%s\tswarmforge-coder@2\tCoder2\tlocal-model\ttask\toff\tforward-only\n' "$WT_CODER2" >> "$dest"
      printf 'coder@iq3\tcoder\t%s\tswarmforge-coder-iq3\tCoderIQ3\tlocal-model\ttask\toff\tforward-only\n' "$WT_IQ3" >> "$dest"
    fi
  }
  write_roles "$ROOT/.swarmforge/roles.tsv"
  write_roles "$WT_CODER/.swarmforge/roles.tsv"
  write_roles "$WT_CLEANER/.swarmforge/roles.tsv"
  write_roles "$WT_CODER2/.swarmforge/roles.tsv"
  write_roles "$WT_IQ3/.swarmforge/roles.tsv"

  if [[ -n "$bare_seat" ]]; then
    # scenario 05: the roster's "<seat>" seat runs on local-model instead -
    # force exactly one existing row's agent column to local-model.
    for f in "$ROOT/.swarmforge/roles.tsv" "$WT_CODER/.swarmforge/roles.tsv" "$WT_CLEANER/.swarmforge/roles.tsv" "$WT_CODER2/.swarmforge/roles.tsv" "$WT_IQ3/.swarmforge/roles.tsv"; do
      sed -i.bak "s/^${bare_seat}\t\([^\t]*\)\t\([^\t]*\)\t\([^\t]*\)\t\([^\t]*\)\tclaude\t/${bare_seat}\t\1\t\2\t\3\t\4\tlocal-model\t/" "$f"
      rm -f "$f.bak"
    done
  fi

  {
    printf '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
    printf '2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
    printf '3\tcoordinator\tswarmforge-coordinator\tCoordinator\tclaude\n'
    if [[ "$make_local_rows" == 1 ]]; then
      printf '4\tcoder@2\tswarmforge-coder@2\tCoder2\tlocal-model\n'
      printf '5\tcoder@iq3\tswarmforge-coder-iq3\tCoderIQ3\tlocal-model\n'
    fi
  } > "$ROOT/.swarmforge/sessions.tsv"

  # BL-1861 bounce (hardener, 2026-10-03): the REAL launch script is never
  # this idealized two-line shape - write_role_launch_script concatenates
  # every agent's guard block before launch_body. An inert, quoted,
  # EARLIER OPENAI_BASE_URL assignment (cerebras_guard's own, never
  # executed for a local-model seat) and an earlier, quoted --model
  # recording call (local_seat_settings_snapshot_cli.bb, BL-1850) both sit
  # before the real, governing lines - exactly what tripped
  # parse-launch-script's old first-match regex on the live host.
  launch_script() {
    local dest="$1" session="$2"
    cat > "$dest" <<SCRIPT
#!/usr/bin/env zsh
if [[ "\${SWARMFORGE_USE_CEREBRAS:-}" == "1" ]]; then
  export OPENAI_BASE_URL="\${OPENAI_BASE_URL:-https://api.cerebras.ai/v1}"
fi
export OPENAI_API_BASE='http://127.0.0.1:$PORT/v1'
export OPENAI_BASE_URL='http://127.0.0.1:$PORT/v1'
bb 'local_seat_settings_snapshot_cli.bb' '$ROOT' --seat '$session' --model '$MODEL' --endpoint-url 'http://127.0.0.1:$PORT/v1' >/dev/null || true
qwen --auth-type openai -y --model $MODEL -i "hello ($session)"
SCRIPT
    chmod +x "$dest"
  }
  if [[ "$make_local_rows" == 1 ]]; then
    launch_script "$ROOT/.swarmforge/launch/coder@2.sh" "coder@2"
    launch_script "$ROOT/.swarmforge/launch/coder@iq3.sh" "coder@iq3"
  fi

  tmux -S "$SOCK" new-session -d -s swarmforge-coder -n agent 2>/dev/null
  tmux -S "$SOCK" new-session -d -s swarmforge-cleaner -n agent 2>/dev/null
  tmux -S "$SOCK" new-session -d -s swarmforge-coordinator -n agent 2>/dev/null
  if [[ "$make_local_rows" == 1 ]]; then
    tmux -S "$SOCK" new-session -d -s swarmforge-coder@2 -n agent 2>/dev/null
    tmux -S "$SOCK" new-session -d -s swarmforge-coder-iq3 -n agent 2>/dev/null
  fi
}

snapshot_roster() {
  cat "$ROOT/.swarmforge/roles.tsv" "$ROOT/.swarmforge/sessions.tsv" \
    "$WT_CODER/.swarmforge/roles.tsv" "$WT_CLEANER/.swarmforge/roles.tsv" \
    "$WT_CODER2/.swarmforge/roles.tsv" "$WT_IQ3/.swarmforge/roles.tsv" 2>/dev/null
}

# ── Scenario 01: remove takes every local-model seat out of every roster
#    copy and stops its session ───────────────────────────────────────────
make_fixture 1
start_stub_ollama "$PORT" "$MODEL"

OUT_01="$(bash "$LOCAL_LLM" "$ROOT" remove)"
RC_01=$?
[[ "$RC_01" -eq 0 ]] || fail "01: expected exit 0, got $RC_01: $OUT_01"

for f in "$ROOT/.swarmforge/roles.tsv" "$WT_CODER/.swarmforge/roles.tsv" "$WT_CLEANER/.swarmforge/roles.tsv" "$WT_CODER2/.swarmforge/roles.tsv" "$WT_IQ3/.swarmforge/roles.tsv"; do
  grep -qE "$(printf '^coder@2\t|^coder@iq3\t')" "$f" && fail "01: $f still lists a local-model seat"
done
grep -qE "$(printf '\tcoder@2\t|\tcoder@iq3\t')" "$ROOT/.swarmforge/sessions.tsv" && fail "01: sessions.tsv still lists a local-model seat"
pass "01: no roster copy lists coder@2 or coder@iq3"

for f in "$ROOT/.swarmforge/roles.tsv" "$WT_CODER/.swarmforge/roles.tsv" "$WT_CLEANER/.swarmforge/roles.tsv" "$WT_CODER2/.swarmforge/roles.tsv" "$WT_IQ3/.swarmforge/roles.tsv"; do
  grep -q "$(printf '^coder\tcoder\t')" "$f" || fail "01: $f lost the sibling seat coder"
  grep -q "$(printf '^cleaner\tcleaner\t')" "$f" || fail "01: $f lost the sibling seat cleaner"
  grep -q "$(printf '^coordinator\tcoordinator\t')" "$f" || fail "01: $f lost the sibling seat coordinator"
done
grep -q "$(printf '^1\tcoder\t')" "$ROOT/.swarmforge/sessions.tsv" || fail "01: sessions.tsv lost coder"
pass "01: the roster rows of coder, cleaner and coordinator are unchanged"

tmux -S "$SOCK" has-session -t swarmforge-coder@2 2>/dev/null && fail "01: coder@2's session still exists"
tmux -S "$SOCK" has-session -t swarmforge-coder-iq3 2>/dev/null && fail "01: coder@iq3's session still exists"
tmux -S "$SOCK" has-session -t swarmforge-coder 2>/dev/null || fail "01: coder's session is gone"
tmux -S "$SOCK" has-session -t swarmforge-cleaner 2>/dev/null || fail "01: cleaner's session is gone"
tmux -S "$SOCK" has-session -t swarmforge-coordinator 2>/dev/null || fail "01: coordinator's session is gone"
pass "01: the sessions of coder@2 and coder@iq3 are stopped; the other seats' sessions survive"

[[ -f "$ROOT/.swarmforge/local-llm/removed.json" ]] || fail "01: no removed.json record was written"
grep -q '"coder@2"' "$ROOT/.swarmforge/local-llm/removed.json" || fail "01: the record does not name coder@2"
grep -q '"coder@iq3"' "$ROOT/.swarmforge/local-llm/removed.json" || fail "01: the record does not name coder@iq3"
pass "01: the removal record names coder@2 and coder@iq3 with the rows they had"

# ── Scenario 02: remove unloads the model the removed seats name and
#    nothing else ──────────────────────────────────────────────────────────
make_fixture 1
start_stub_ollama "$PORT" "$MODEL,outside-task:latest"

OUT_02="$(bash "$LOCAL_LLM" "$ROOT" remove)"
RC_02=$?
[[ "$RC_02" -eq 0 ]] || fail "02: expected exit 0, got $RC_02: $OUT_02"

PS_AFTER_02="$(curl -sS "http://127.0.0.1:$PORT/api/ps")"
echo "$PS_AFTER_02" | grep "\"$MODEL\"" >/dev/null && fail "02: $MODEL is still loaded on the stub server: $PS_AFTER_02"
pass "02: $MODEL is not loaded on the stub model server"

echo "$PS_AFTER_02" | grep '"outside-task:latest"' >/dev/null || fail "02: outside-task:latest was unloaded too: $PS_AFTER_02"
pass "02: outside-task:latest is still loaded on the stub model server"

curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ps" | grep '^200$' >/dev/null \
  || fail "02: the stub model server is no longer running"
pass "02: the stub model server is still running"

echo "$OUT_02" | grep '^GPU_MEMORY_MIB:' >/dev/null || fail "02: no GPU memory line in output: $OUT_02"
pass "02: the output reports the GPU memory in use after the unload"

# ── Scenario 03 row 1: already removed -> remove again says so ───────────
make_fixture 1
start_stub_ollama "$PORT" "$MODEL"
bash "$LOCAL_LLM" "$ROOT" remove >/dev/null || fail "03/row1: the first remove (establishing 'already removed') failed"

ROSTER_BEFORE_03A="$(snapshot_roster)"
OUT_03A="$(bash "$LOCAL_LLM" "$ROOT" remove)"
RC_03A=$?
[[ "$RC_03A" -eq 0 ]] || fail "03/row1: expected exit 0, got $RC_03A: $OUT_03A"
echo "$OUT_03A" | grep -i "already removed" >/dev/null || fail "03/row1: expected 'already removed' in output: $OUT_03A"
[[ "$(snapshot_roster)" == "$ROSTER_BEFORE_03A" ]] || fail "03/row1: a roster copy changed on the second remove"
curl -sS "http://127.0.0.1:$PORT/api/ps" | grep "\"$MODEL\"" >/dev/null && fail "03/row1: $MODEL is loaded again"
pass "03/row1: already-removed remove exits 0, says so, changes no roster, model stays not loaded"

# ── Scenario 03 row 2: no local-model seat, no record -> says so ─────────
make_fixture 0
start_stub_ollama "$PORT" "$MODEL"

ROSTER_BEFORE_03B="$(snapshot_roster)"
OUT_03B="$(bash "$LOCAL_LLM" "$ROOT" remove)"
RC_03B=$?
[[ "$RC_03B" -eq 0 ]] || fail "03/row2: expected exit 0, got $RC_03B: $OUT_03B"
echo "$OUT_03B" | grep -i "no local-model seat" >/dev/null || fail "03/row2: expected 'no local-model seat' in output: $OUT_03B"
[[ "$(snapshot_roster)" == "$ROSTER_BEFORE_03B" ]] || fail "03/row2: a roster copy changed"
curl -sS "http://127.0.0.1:$PORT/api/ps" | grep "\"$MODEL\"" >/dev/null || fail "03/row2: $MODEL was unloaded despite no record"
pass "03/row2: no-local-seat-no-record remove exits 0, says so, changes nothing, model stays loaded"

# ── Scenario 04: remove reports every parcel a removed seat holds and
#    moves none ────────────────────────────────────────────────────────────
make_fixture 1
start_stub_ollama "$PORT" "$MODEL"

IN_PROCESS_FILE="$WT_CODER2/.swarmforge/handoffs/inbox/in_process/00_test_bl9001.handoff"
NEW_FILE="$WT_CODER2/.swarmforge/handoffs/inbox/new/50_test_bl9002.handoff"
printf 'id: t1\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-9001\ncommit: 1234567890\n' > "$IN_PROCESS_FILE"
printf 'id: t2\nfrom: architect\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-9002\ncommit: abcdefabcd\n' > "$NEW_FILE"
IN_PROCESS_BEFORE="$(cat "$IN_PROCESS_FILE")"
NEW_BEFORE="$(cat "$NEW_FILE")"

OUT_04="$(bash "$LOCAL_LLM" "$ROOT" remove)"
RC_04=$?
[[ "$RC_04" -eq 0 ]] || fail "04: expected exit 0, got $RC_04: $OUT_04"

echo "$OUT_04" | grep "LOCAL_LLM_SEAT_PARCEL: coder@2 in_process BL-9001" >/dev/null || fail "04: BL-9001/in_process not reported: $OUT_04"
echo "$OUT_04" | grep "LOCAL_LLM_SEAT_PARCEL: coder@2 new BL-9002" >/dev/null || fail "04: BL-9002/new not reported: $OUT_04"
pass "04: the output names both parcels with their tickets and mailboxes"

[[ -f "$IN_PROCESS_FILE" && "$(cat "$IN_PROCESS_FILE")" == "$IN_PROCESS_BEFORE" ]] || fail "04: the in_process parcel file changed or moved"
[[ -f "$NEW_FILE" && "$(cat "$NEW_FILE")" == "$NEW_BEFORE" ]] || fail "04: the new parcel file changed or moved"
pass "04: both parcel files are byte-identical where they were"

[[ -d "$WT_CODER2" ]] || fail "04: coder@2's worktree was removed"
[[ -d "$WT_CODER2/.swarmforge/handoffs" ]] || fail "04: coder@2's mailbox was removed"
pass "04: the worktree, branch and mailbox of coder@2 still exist"

# ── Scenario 05: remove refuses and changes nothing when a local-model
#    seat is a bare seat ───────────────────────────────────────────────────
for BARE_SEAT in coder coordinator; do
  make_fixture 1 "$BARE_SEAT"
  start_stub_ollama "$PORT" "$MODEL"

  ROSTER_BEFORE_05="$(snapshot_roster)"
  set +e
  OUT_05="$(bash "$LOCAL_LLM" "$ROOT" remove 2>&1)"
  RC_05=$?
  set -e
  [[ "$RC_05" -ne 0 ]] || fail "05/$BARE_SEAT: expected a non-zero exit, got 0: $OUT_05"
  echo "$OUT_05" | grep "$BARE_SEAT" >/dev/null || fail "05/$BARE_SEAT: the refusal does not name $BARE_SEAT: $OUT_05"
  pass "05/$BARE_SEAT: remove exits non-zero naming $BARE_SEAT"

  [[ "$(snapshot_roster)" == "$ROSTER_BEFORE_05" ]] || fail "05/$BARE_SEAT: a roster copy changed"
  pass "05/$BARE_SEAT: no roster copy changes"

  tmux -S "$SOCK" has-session -t "swarmforge-$BARE_SEAT" 2>/dev/null || fail "05/$BARE_SEAT: $BARE_SEAT's own session was killed"
  tmux -S "$SOCK" has-session -t swarmforge-coder@2 2>/dev/null || fail "05/$BARE_SEAT: coder@2's session was killed"
  pass "05/$BARE_SEAT: no session is killed"

  curl -sS "http://127.0.0.1:$PORT/api/ps" | grep "\"$MODEL\"" >/dev/null || fail "05/$BARE_SEAT: the model was unloaded"
  pass "05/$BARE_SEAT: no model is unloaded"
done

# ── Scenario 06: remove exits non-zero when the model is still loaded
#    after its bounded wait ────────────────────────────────────────────────
make_fixture 1
start_stub_ollama "$PORT" "$MODEL" "$MODEL"

set +e
OUT_06="$(bash "$LOCAL_LLM" "$ROOT" remove 2>&1)"
RC_06=$?
set -e
[[ "$RC_06" -ne 0 ]] || fail "06: expected a non-zero exit, got 0: $OUT_06"
echo "$OUT_06" | grep "$MODEL" >/dev/null || fail "06: the refusal does not name $MODEL: $OUT_06"
pass "06: remove exits non-zero naming $MODEL once the wait bound has passed"

grep -qE "$(printf '^coder@2\t|^coder@iq3\t')" "$ROOT/.swarmforge/roles.tsv" && fail "06: a local-model seat is still in the master roster"
pass "06: no roster copy lists coder@2 or coder@iq3"

echo "$OUT_06" | grep -i "run.*remove again" >/dev/null || fail "06: the output does not say to run remove again: $OUT_06"
pass "06: the output says to run remove again to retry the unload"

echo "test_bl1861_local_llm_remove: ALL SCENARIOS PASSED"
