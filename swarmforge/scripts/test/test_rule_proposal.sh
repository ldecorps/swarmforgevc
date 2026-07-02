#!/usr/bin/env bash
# BL-035: rule_proposal handoff type — any agent can propose a constitution
# or role-prompt rule to the specifier; every delivered proposal lands in a
# durable audit log regardless of the specifier's eventual accept/reject
# decision (that review is prompt/agent behavior, not scriptable here).
#
# Covers acceptance scenarios BL-035 rule-proposal-01..04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with a coder worktree + specifier on master ───────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

ROLES="specifier\tmaster\t$ROOT\tswarmforge-specifier\tSpecifier\tclaude\ttask
coder\tcoder\t$CODER_WT\tswarmforge-coder\tCoder\tclaude\ttask
"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$CODER_WT/.swarmforge"
printf "$ROLES" > "$CODER_WT/.swarmforge/roles.tsv"

CODER_OUTBOX="$CODER_WT/.swarmforge/handoffs/outbox"
SPECIFIER_INBOX_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
mkdir -p "$CODER_OUTBOX"

# ── fake tmux so notify! succeeds without a real session ────────────────────
FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

make_draft() {
  local dir="$1"; shift
  mkdir -p "$dir/tmp"
  local file="$dir/tmp/draft_$RANDOM.txt"
  printf '%s\n' "$@" > "$file"
  echo "$file"
}

# ── 01: a valid proposal is queued and delivered to the specifier's inbox ───
DRAFT="$(make_draft "$CODER_WT" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'scope: constitution' \
  'body: Batch roles must forward every parcel, not just their own step.' \
  'rationale: BL-075 dropped a docs-only parcel this way.')"
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$DRAFT")"
grep -q "^HANDOFF QUEUED:" <<< "$OUT" || fail "01: valid rule_proposal was not queued; got: $OUT"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!
for _ in $(seq 1 40); do
  remaining="$(find "$CODER_OUTBOX" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$remaining" == "0" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
[[ "$remaining" == "0" ]] || fail "01: daemon did not drain the outbox"

[[ -n "$(find "$SPECIFIER_INBOX_NEW" -maxdepth 1 -name '*.handoff' 2>/dev/null)" ]] \
  || fail "01: proposal was not delivered to the specifier's inbox/new/"
grep -q "^type: rule_proposal$" "$SPECIFIER_INBOX_NEW"/*.handoff || fail "01: delivered copy missing type header"
grep -q "^scope: constitution$" "$SPECIFIER_INBOX_NEW"/*.handoff || fail "01: delivered copy missing scope header"
pass "01: a valid rule_proposal is queued and the daemon delivers it to the specifier's inbox"

# ── 03: the delivered proposal lands in the durable audit log ───────────────
MONTH="$(date -u +%Y-%m)"
AUDIT_FILE="$ROOT/.swarmforge/rule_proposals/$MONTH.jsonl"
[[ -f "$AUDIT_FILE" ]] || fail "03: no audit log file written at $AUDIT_FILE"
[[ "$(wc -l < "$AUDIT_FILE" | tr -d ' ')" == "1" ]] || fail "03: expected exactly one audit line"
grep -q '"scope":"constitution"' "$AUDIT_FILE" || fail "03: audit line missing scope"
grep -q '"body":"Batch roles must forward every parcel, not just their own step."' "$AUDIT_FILE" \
  || fail "03: audit line missing body"
grep -q '"rationale":"BL-075 dropped a docs-only parcel this way."' "$AUDIT_FILE" \
  || fail "03: audit line missing rationale"
grep -q '"proposer":"coder"' "$AUDIT_FILE" || fail "03: audit line missing proposer"
grep -q '"timestamp":"' "$AUDIT_FILE" || fail "03: audit line missing timestamp"
pass "03: every delivered proposal lands in the durable audit log with scope/body/rationale/proposer/timestamp"

# ── 02: invalid proposals are rejected at the validation gate ───────────────
assert_rejected() {
  local label="$1"; shift
  local before after
  before="$(find "$CODER_OUTBOX" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
  local draft
  draft="$(make_draft "$CODER_WT" "$@")"
  set +e
  OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$draft" 2>&1)"
  RC=$?
  set -e
  [[ $RC -ne 0 ]] || fail "02 ($label): invalid draft was not rejected; got: $OUT"
  after="$(find "$CODER_OUTBOX" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$before" == "$after" ]] || fail "02 ($label): a rejected draft still queued a handoff"
  echo "$OUT"
}

OUT="$(assert_rejected "missing scope" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'body: some rule' 'rationale: some reason')"
grep -qi "scope" <<< "$OUT" || fail "02 (missing scope): error did not name the offending field; got: $OUT"

OUT="$(assert_rejected "missing body" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'scope: constitution' 'rationale: some reason')"
grep -qi "'body'" <<< "$OUT" || fail "02 (missing body): error did not name the offending field; got: $OUT"

OUT="$(assert_rejected "missing rationale" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'scope: constitution' 'body: some rule')"
grep -qi "rationale" <<< "$OUT" || fail "02 (missing rationale): error did not name the offending field; got: $OUT"

LONG_BODY="$(printf 'x%.0s' {1..201})"
OUT="$(assert_rejected "body over 200 chars" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'scope: constitution' "body: $LONG_BODY" 'rationale: some reason')"
grep -qi "'body'" <<< "$OUT" || fail "02 (long body): error did not name the offending field; got: $OUT"

OUT="$(assert_rejected "scope not in the valid set" \
  'type: rule_proposal' 'to: specifier' 'priority: 50' \
  'scope: not-a-real-scope' 'body: some rule' 'rationale: some reason')"
grep -qi "scope" <<< "$OUT" || fail "02 (bad scope): error did not name the offending field; got: $OUT"

pass "02: invalid rule_proposal drafts are rejected at the validation gate, naming the offending field"

# ── 04: existing message types are unaffected ────────────────────────────────
for draft_lines in \
  "type: awake|to: specifier|priority: 50" \
  "type: git_handoff|to: specifier|priority: 50|task: bl-035-regress|commit: $COMMIT" \
  "type: note|to: specifier|priority: 50|message: unaffected by rule_proposal"; do
  IFS='|' read -ra LINES <<< "$draft_lines"
  DRAFT="$(make_draft "$CODER_WT" "${LINES[@]}")"
  OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$DRAFT")"
  grep -q "^HANDOFF QUEUED:" <<< "$OUT" || fail "04: existing type regressed for draft [$draft_lines]; got: $OUT"
done
pass "04: awake, git_handoff, and note drafts still validate and queue exactly as before"

echo "ALL PASS"
