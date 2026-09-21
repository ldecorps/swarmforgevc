#!/usr/bin/env bash
# BL-1640: a finish-shift sleep runs the closing ceremony to its end before
# the stack stops. Drives the REAL finish_shift_run_closing_ceremony loop
# (finish_shift_lib.sh) and the real compiled ceremony CLI against fixture
# swarms - never a dry run.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$REPO_ROOT/extension/out/tools/night-closing-ceremony-run.js"
LIVE_MODULE="$REPO_ROOT/extension/out/quality/nightClosingCeremonyLive.js"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1640-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1640_SUITE_BOUND_SECONDS:-300}" "$@"
trap 'rm -rf "$WORK"' EXIT

if [[ ! -f "$CLI" || ! -f "$LIVE_MODULE" ]]; then
  fail "the ceremony CLI/module is not compiled - run npm run compile from extension/"
  echo "FAILURES"; exit 1
fi

# A fixture swarm: its own conf (small drain/briefing budgets), a daemon
# state dir, a git repo (the CLI resolves its project root by finding
# .swarmforge/roles.tsv), and a shift-start stamp.
make_root() {  # make_root <name>
  root="$WORK/$1"
  mkdir -p "$root/.swarmforge/daemon" "$root/.swarmforge/lean/ceremony" \
           "$root/.swarmforge/handoffs/inbox/new" "$root/.swarmforge/handoffs/inbox/in_process" \
           "$root/swarmforge" "$root/docs/briefings"
  printf 'config closure_stop_local 08:45\nconfig closing_drain_budget_minutes 2\nconfig closing_briefing_budget_minutes 1\n' \
    > "$root/swarmforge/swarmforge.conf"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  git init -q -b main "$root" >/dev/null 2>&1
  git -C "$root" config user.email t@t >/dev/null 2>&1
  git -C "$root" config user.name t >/dev/null 2>&1
  git -C "$root" config commit.gpgsign false >/dev/null 2>&1
  ( cd "$root" && git add -A >/dev/null 2>&1 && git commit -qm seed >/dev/null 2>&1 )
  printf '2026-09-04T09:00:00Z\n' > "$root/.swarmforge/shift-started"
}

run_loop() {  # run_loop <root> [extra env "NAME=value" ...]
  local root="$1"; shift
  ( cd "$root" && source "$SCRIPT_DIR/../finish_shift_lib.sh" \
      && FINISH_SHIFT_CEREMONY_CLI="$CLI" FINISH_SHIFT_CEREMONY_TICK_SECONDS=0 "$@" \
         finish_shift_run_closing_ceremony "$root" 2>&1 )
}

state_field() {  # state_field <root> <field>
  node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = s[process.argv[2]];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch { process.stdout.write(""); }
  ' "$root/.swarmforge/daemon/closing-ceremony-state.json" "$2"
}

sent_today() {  # sent_today <root>
  local today; today="$(date +%Y-%m-%d)"
  mkdir -p "$1/docs/briefings"
  printf '["%s.md"]' "$today" > "$1/docs/briefings/.sent.json"
}

# ── 01: a sleep with in-flight work reaches done before any stop runs ────
make_root sc01
touch "$root/.swarmforge/handoffs/inbox/in_process/x.handoff"
( sleep 0.2; rm -f "$root/.swarmforge/handoffs/inbox/in_process/x.handoff" ) &
BG01=$!
( sleep 0.4; sent_today "$root" ) &
BG01b=$!
out01="$(run_loop "$root")"
rc01=$?
wait "$BG01" "$BG01b" 2>/dev/null || true
phase01="$(state_field "$root" phase)"
if [[ "$rc01" -eq 0 && "$phase01" == "done" ]]; then
  pass "the ceremony state reads done before the babysitterd stop runs"
else
  fail "expected phase done (rc=$rc01, phase=$phase01): $out01"
fi
seq01="$(state_field "$root" sequence)"
notes01=""
[[ -f "$root/.swarmforge/daemon/closing-ceremony-notes.log" ]] && notes01="$(cat "$root/.swarmforge/daemon/closing-ceremony-notes.log")"
if grep -q 'lean-packet' <<<"$seq01,$out01" && grep -qi 'morning briefing' <<<"$notes01,$out01"; then
  pass "the recorded sequence contains lean-packet and the documenter is instructed to produce the morning briefing"
else
  fail "expected lean-packet + a documenter briefing instruction: seq=$seq01 notes=$notes01 out=$out01"
fi

# ── 02: a briefing sent between ticks ends with send-confirmed, not missing ──
make_root sc02
( sleep 0.2; sent_today "$root" ) &
BG02=$!
out02="$(run_loop "$root")"
wait "$BG02" 2>/dev/null || true
phase02="$(state_field "$root" phase)"
if [[ "$phase02" == "done" ]] && ! grep -q 'closing-briefing-missing' <<<"$out02"; then
  pass "the recorded sequence ends with briefing-committed, send-confirmed, swarm-stopped"
  pass "closing-briefing-missing is not surfaced"
else
  fail "expected a clean send-confirmed done, got phase=$phase02: $out02"
fi

# ── 03: deadlines are relative to the sleep, never the closure time ──────
make_root sc03
sleep_at_ms="$(node -e 'process.stdout.write(String(Date.UTC(2026,8,21,16,0,0)))')"
out03="$(cd "$root" && node "$CLI" --target "$root" --conf "$root/swarmforge/swarmforge.conf" --now "$sleep_at_ms" --sleep-path finish-shift 2>&1)"
drain03="$(node -e 'try{const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.state.drainDeadlineMs))}catch{process.stdout.write("")}' <<<"$out03")"
hard03="$(node -e 'try{const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.state.hardDeadlineMs))}catch{process.stdout.write("")}' <<<"$out03")"
if [[ "$drain03" == "$((sleep_at_ms + 2*60000))" && "$hard03" == "$((sleep_at_ms + 3*60000))" ]]; then
  pass "the state's drainDeadlineMs and hardDeadlineMs equal the start time plus 2 and 3 minutes respectively"
else
  fail "expected drainDeadlineMs=$((sleep_at_ms + 2*60000)) hardDeadlineMs=$((sleep_at_ms + 3*60000)), got drain=$drain03 hard=$hard03: $out03"
fi
freeze_until03="$(grep -o '"untilMs": *[0-9]*' <<<"$out03" | head -1 | grep -o '[0-9]*$')"
if [[ "$freeze_until03" == "$hard03" ]]; then
  pass "the freeze written for promotion lasts until that hardDeadlineMs"
else
  fail "expected the freeze's untilMs ($freeze_until03) to equal hardDeadlineMs ($hard03)"
fi

# ── 04: a second sleep after a worked shift is a new ceremony ────────────
make_root sc04
sent_today "$root"
out04a="$(run_loop "$root")"
phase04a="$(state_field "$root" phase)"
started04a="$(state_field "$root" startedAtMs)"
if [[ "$phase04a" != "done" ]]; then
  fail "sc04 setup: expected the first sleep to already read done, got $phase04a: $out04a"
fi
rm -f "$root/docs/briefings/.sent.json"
# The first sleep's own lean pass just recorded an outcome - "worked a shift
# SINCE the last ceremony" is otherwise now false. A real new shift bumps
# shift-started's mtime (a fresh swarmforge.sh launch); simulate that here.
sleep 0.05
touch "$root/.swarmforge/shift-started"
before04b_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
( sleep 0.3; sent_today "$root" ) &
BG04=$!
out04b="$(run_loop "$root")"
wait "$BG04" 2>/dev/null || true
seq04b="$(state_field "$root" sequence)"
started04b="$(state_field "$root" startedAtMs)"
if grep -q 'freeze-promotion' <<<"$seq04b"; then
  pass "a second sleep on the same day after a shift of work starts a new ceremony over freeze-promotion"
else
  fail "expected the sequence to begin again with freeze-promotion: $seq04b"
fi
if [[ -n "$started04b" && "$started04b" -ge "$before04b_ms" && "$started04b" != "$started04a" ]]; then
  pass "the state's startedAtMs is the new sleep's time"
else
  fail "expected startedAtMs ($started04b) to be the NEW sleep's time (>= $before04b_ms, != first sleep's $started04a)"
fi

# ── 05: a second sleep with no shift since stays a no-op ─────────────────
make_root sc05
# workedAShift fails open to true when no ceremony was ever recorded (a
# missing stamp must never silence a real ceremony) - a genuine "no shift
# since" fixture needs a RECORDED prior ceremony newer than shift-started.
printf '{"shiftKey":"2026-01-01","outcome":{"type":"no_change"}}\n' \
  > "$root/.swarmforge/lean/ceremony/2026-01-01.json"
touch -d '2026-01-02 00:00' "$root/.swarmforge/lean/ceremony/2026-01-01.json" 2>/dev/null || true
touch -d '2026-01-01 00:00' "$root/.swarmforge/shift-started" 2>/dev/null \
  || printf '2026-01-01T00:00:00Z\n' > "$root/.swarmforge/shift-started"
out05a="$(run_loop "$root")"
phase05a="$(state_field "$root" phase)"
before05="$(cat "$root/.swarmforge/daemon/closing-ceremony-state.json" 2>/dev/null)"
notes_before05=""
[[ -f "$root/.swarmforge/daemon/closing-ceremony-notes.log" ]] && notes_before05="$(cat "$root/.swarmforge/daemon/closing-ceremony-notes.log")"
out05b="$(run_loop "$root")"
after05="$(cat "$root/.swarmforge/daemon/closing-ceremony-state.json" 2>/dev/null)"
notes_after05=""
[[ -f "$root/.swarmforge/daemon/closing-ceremony-notes.log" ]] && notes_after05="$(cat "$root/.swarmforge/daemon/closing-ceremony-notes.log")"
if [[ "$phase05a" == "done" && "$before05" == "$after05" ]]; then
  pass "a second sleep with no shift since stays a no-op: the ceremony state is unchanged"
else
  fail "expected an unchanged done state across the second sleep: phase05a=$phase05a before=$before05 after=$after05"
fi
if [[ "$notes_before05" == "$notes_after05" ]]; then
  pass "no note is queued for any role"
else
  fail "expected no note queued by the second (no-op) sleep, log grew: before=[$notes_before05] after=[$notes_after05]"
fi

# ── 06: bedtime never hangs ───────────────────────────────────────────────
make_root sc06
FAKE_CLI="$root/fake-cli.js"
cat > "$FAKE_CLI" <<'EOF'
process.stdout.write(JSON.stringify({
  gateMode: 'sleep:finish-shift',
  advanced: true,
  state: { phase: 'frozen', hardDeadlineMs: Date.now() - 10 * 60 * 1000 },
  actions: [],
}) + '\n');
EOF
out06="$(cd "$root" && source "$SCRIPT_DIR/../finish_shift_lib.sh" \
  && FINISH_SHIFT_CEREMONY_CLI="$FAKE_CLI" FINISH_SHIFT_CEREMONY_TICK_SECONDS=0 \
     finish_shift_run_closing_ceremony "$root" 2>&1)"
rc06=$?
if [[ "$rc06" -eq 0 ]]; then
  pass "finish-shift exits with status 0"
else
  fail "expected status 0 on overrun, got $rc06: $out06"
fi
if grep -qi 'overran its budgets' <<<"$out06"; then
  pass "finish-shift reports that the closing ceremony overran its budgets"
else
  fail "expected an overrun message: $out06"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
