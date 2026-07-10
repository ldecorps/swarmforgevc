#!/usr/bin/env bash
# BL-092: end-to-end proof that remote_wakeup_nudge.bb correctly decides
# nudge/no-nudge and, when nudging, wakes the RIGHT specifier session via
# the swarm's own tmux socket - reusing the same notify-agent! mechanism
# handoffd.bb's own notify! already uses (that mechanism's own retry/
# verification behavior is covered by test_handoffd_notify_verified.sh;
# this file scopes to what BL-092 adds: the nudge/no-nudge decision and
# graceful degradation when the swarm isn't running).
# Covers acceptance scenarios BL-092 wakeup-bridge-01..03 (bridge-04, the
# periodic-pull fallback, is covered by test_remote_wakeup_periodic_pull.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NUDGE="$SCRIPT_DIR/../remote_wakeup_nudge.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'specifier\tmaster\t%s\tswarmforge-second-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$ROOT/backlog/active"
printf 'id: BL-1\ntitle: "demo"\nswarm: second\n' > "$ROOT/backlog/active/BL-1-demo.yaml"
printf 'id: BL-2\ntitle: "demo"\n' > "$ROOT/backlog/active/BL-2-demo.yaml" # primary (no swarm: field)

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$@" >> "$CALL_LOG"
case "\$*" in
  *capture-pane*) echo '\$ ' ;;
  *) exit 0 ;;
esac
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── wakeup-bridge-01: a push assigning work to this swarm wakes the
#     specifier via the real tmux socket ────────────────────────────────────
OUT="$(PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" second backlog/active/BL-1-demo.yaml)"
grep -q "^NUDGED:" <<< "$OUT" || fail "01: expected a NUDGED result; got: $OUT"
grep -q "swarmforge-second-specifier" "$CALL_LOG" || fail "01: expected tmux to target the specifier's session; log: $(cat "$CALL_LOG")"
pass "01: a push assigning work to this swarm wakes the specifier via the real tmux socket"
: > "$CALL_LOG"

# ── wakeup-bridge-02: other-swarm pushes do not nudge ───────────────────────
OUT="$(PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" second backlog/active/BL-2-demo.yaml)"
grep -q "^NO_NUDGE:" <<< "$OUT" || fail "02: expected NO_NUDGE; got: $OUT"
[[ ! -s "$CALL_LOG" ]] || fail "02: expected no tmux call at all; log: $(cat "$CALL_LOG")"
pass "02: a push touching only the primary swarm's items does not wake this swarm's specifier"

# ── wakeup-bridge-03: duplicate/repeated nudges are harmless ───────────────
PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" second backlog/active/BL-1-demo.yaml >/dev/null
OUT="$(PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" second backlog/active/BL-1-demo.yaml)"
grep -q "^NUDGED:" <<< "$OUT" || fail "03: expected a repeated nudge to still succeed harmlessly; got: $OUT"
pass "03: a duplicate/repeated nudge for the same already-processed item is harmless"

# ── bridge outage / swarm not running degrades gracefully ──────────────────
NO_SWARM_ROOT="$(mktemp -d)"
mkdir -p "$NO_SWARM_ROOT/backlog/active"
printf 'id: BL-1\ntitle: "demo"\nswarm: second\n' > "$NO_SWARM_ROOT/backlog/active/BL-1-demo.yaml"
OUT="$(bb "$NUDGE" "$NO_SWARM_ROOT" second backlog/active/BL-1-demo.yaml)"
grep -q "^NO_NUDGE:" <<< "$OUT" || fail "04: expected a graceful NO_NUDGE with no swarm running; got: $OUT"
rm -rf "$NO_SWARM_ROOT"
pass "04: with no swarm running (no roles.tsv), the nudge degrades gracefully instead of crashing"

echo "ALL PASS"
