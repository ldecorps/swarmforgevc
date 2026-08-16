#!/usr/bin/env bash
# BL-901: the shared pre-commit/commit-msg hooks refuse a commit whose
# staged changes delete a backlog ticket YAML that survives nowhere else in
# the staged tree and that the commit message never names - the exact
# failure that let c9f888d14 silently drop BL-893 from the tracked backlog.
# A promote/close move and a deliberately named retirement both stay
# allowed; an untracked working-tree copy never excuses a naked deletion.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_ticket_deletion.sh"
SIZE_GUARD="$SCRIPT_DIR/../check_commit_size.sh"
PRE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"
COMMIT_MSG_HOOK="$SCRIPT_DIR/../../git-hooks/commit-msg"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
MSGDIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$MSGDIR"' EXIT
MSG_OMIT="$MSGDIR/msg-omit.txt"

mkdir -p "$ROOT/backlog/paused" "$ROOT/backlog/active" "$ROOT/backlog/done/M8"
echo "id: BL-893" > "$ROOT/backlog/paused/BL-893-approvals-ambulance-choice.yaml"
git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m init

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

# ── 1: a naked deletion with no message-file argument defers (pre-commit
#       time semantics - the message does not exist yet) rather than refuse ─
git -C "$ROOT" rm -q backlog/paused/BL-893-approvals-ambulance-choice.yaml
run_guard || fail "01: with no message-file argument, the guard must defer (exit 0), never refuse"
pass "01: no message-file argument defers to the enforcing (commit-msg) call"

# ── 2: the same naked deletion, message omits the ticket id -> refused ────
echo "unrelated prose change" > "$MSG_OMIT"
set +e
OUT2="$(run_guard "$MSG_OMIT" 2>&1)"
STATUS2=$?
set -e
[[ "$STATUS2" -ne 0 ]] || fail "02: expected the guard to refuse a naked deletion whose message omits the ticket id"
echo "$OUT2" | grep -q "BL-893" || fail "02: refusal must name the ticket id, got: $OUT2"
pass "02: a naked deletion with the ticket id omitted from the message is refused, naming the ticket"

# ── 3: the same naked deletion, message names the ticket id -> allowed ────
echo "Retire BL-893: superseded by BL-905" > "$MSG_OMIT"
run_guard "$MSG_OMIT" || fail "03: expected the guard to allow a naked deletion whose message names the ticket id"
pass "03: a naked deletion named in the commit message is allowed"

git -C "$ROOT" reset -q
git -C "$ROOT" checkout -q -- backlog/paused/BL-893-approvals-ambulance-choice.yaml

# ── 4: promote (paused/ -> active/), unrelated message -> allowed ─────────
git -C "$ROOT" mv backlog/paused/BL-893-approvals-ambulance-choice.yaml backlog/active/BL-893-approvals-ambulance-choice.yaml
echo "totally unrelated message" > "$MSG_OMIT"
run_guard "$MSG_OMIT" || fail "04: a promote (delete+add of the same ticket id) must be allowed regardless of message"
pass "04: promoting a ticket (paused/ to active/) is allowed untouched"
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "promote BL-893"

# ── 5: close (active/ -> done/M8/), unrelated message -> allowed ──────────
git -C "$ROOT" mv backlog/active/BL-893-approvals-ambulance-choice.yaml backlog/done/M8/BL-893-approvals-ambulance-choice.yaml
run_guard "$MSG_OMIT" || fail "05: a close (delete+add of the same ticket id) must be allowed regardless of message"
pass "05: closing a ticket (active/ to done/M8/) is allowed untouched"
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "close BL-893"

# ── 6 (invariant 1): an untracked working-tree copy never excuses a naked
#       deletion - the verdict is a function of the staged tree alone ─────
git -C "$ROOT" rm -q backlog/done/M8/BL-893-approvals-ambulance-choice.yaml
mkdir -p "$ROOT/backlog/done/M8"
echo "id: BL-893" > "$ROOT/backlog/done/M8/BL-893-approvals-ambulance-choice.yaml"
echo "unrelated message" > "$MSG_OMIT"
set +e
OUT6="$(run_guard "$MSG_OMIT" 2>&1)"
STATUS6=$?
set -e
[[ "$STATUS6" -ne 0 ]] || fail "06: an untracked copy in the working tree must not excuse a naked staged deletion"
echo "$OUT6" | grep -q "BL-893" || fail "06: refusal must name the ticket id, got: $OUT6"
pass "06: an untracked working-tree copy of the deleted ticket does not excuse it"

git -C "$ROOT" reset -q
rm -f "$ROOT/backlog/done/M8/BL-893-approvals-ambulance-choice.yaml"
git -C "$ROOT" checkout -q -- backlog/done/M8/BL-893-approvals-ambulance-choice.yaml

# ── 7: a commit that stages no ticket deletion at all is untouched ────────
echo "prose" >> "$ROOT/backlog/done/M8/BL-893-approvals-ambulance-choice.yaml"
git -C "$ROOT" add backlog/done/M8/BL-893-approvals-ambulance-choice.yaml
run_guard "$MSG_OMIT" || fail "07: a commit staging no ticket deletion must never be refused"
pass "07: a commit with no staged ticket deletion is untouched by the guard"
git -C "$ROOT" reset -q
git -C "$ROOT" checkout -q -- backlog/done/M8/BL-893-approvals-ambulance-choice.yaml

# ── 8: wired as real pre-commit + commit-msg hooks via core.hooksPath, an
#       actual `git commit` is blocked - not just the standalone script ──
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$SIZE_GUARD" "$ROOT/swarmforge/scripts/check_commit_size.sh"
cp "$PRE_COMMIT_HOOK" "$ROOT/swarmforge/git-hooks/pre-commit"
cp "$COMMIT_MSG_HOOK" "$ROOT/swarmforge/git-hooks/commit-msg"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/"*
git -C "$ROOT" add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "install hooks fixture"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks

git -C "$ROOT" rm -q backlog/done/M8/BL-893-approvals-ambulance-choice.yaml
set +e
OUT8="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test commit -q -m "unrelated prose change" 2>&1)"
STATUS8=$?
set -e
[[ "$STATUS8" -ne 0 ]] || fail "08: expected a real git commit to be blocked by the installed pre-commit/commit-msg hooks"
echo "$OUT8" | grep -q "BL-893" || fail "08: hook output must name the offending ticket id, got: $OUT8"
pass "08: an installed pre-commit+commit-msg hook pair blocks a real git commit that silently deletes a ticket"

# ── 9: with the hooks installed, naming the ticket still allows the commit ─
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "Retire BL-893: no longer needed" \
  || fail "09: naming the ticket in the commit message must still allow the commit with hooks installed"
pass "09: with the hooks installed, naming the retired ticket in the message allows the commit"

# ── 10 (composition): the pre-existing commit-size guard still refuses an
#       oversized file - confirms replacing `exec` did not disarm it ─────
dd if=/dev/zero of="$ROOT/blob.bin" bs=1048576 count=51 >/dev/null 2>&1
git -C "$ROOT" add blob.bin
set +e
OUT10="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test commit -q -m "oversized" 2>&1)"
STATUS10=$?
set -e
[[ "$STATUS10" -ne 0 ]] || fail "10: expected the commit-size guard to still block an oversized file"
echo "$OUT10" | grep -q "blob.bin" || fail "10: size-guard output must name the offending file, got: $OUT10"
pass "10: the pre-existing commit-size guard still runs alongside the new ticket-deletion guard"

echo "ALL PASS"
