#!/usr/bin/env bash
# BL-1360: the ceremony composer's ENTRY POINT, exercised end to end.
#
# ceremony_handoff_lib_test_runner.bb covers the pure composition. This file
# covers the part that only exists at the process boundary and that a pure
# test cannot see: that `ceremony_handoff.sh` shells to the REAL
# swarm_handoff.sh, that a refusal from that gate reaches the sender's stderr
# with its own words, and that the exit status is the gate's own. Every one of
# those was wrong at least once while this slice was written - the refusal was
# swallowed entirely by a flush outside its binding, so the sender saw exit 2
# and no reason at all.
#
# No timers, no daemon, no real tmux: a fake tmux on PATH, one throwaway git
# root, and swarm_handoff's own mailbox skeleton.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CEREMONY="$SCRIPT_DIR/../ceremony_handoff.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

TICKET="BL-9361"
COMMIT_ABBREV="a1b2c3d4e5"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: an intentional throwaway root
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" -c commit.gpgsign=false commit -q --allow-empty -m init

mkdir -p "$ROOT/.swarmforge/handoffs/QA/outbox/tmp" "$ROOT/.swarmforge/handoffs/QA/sent"
touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

# hardender is deliberately absent from roles.tsv further down; the roles that
# ARE known get a real inbox each.
KNOWN=(coder cleaner architect documenter coordinator specifier QA)
for role in "${KNOWN[@]}" hardender; do
  mkdir -p "$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/new"
done

write_roles() {
  : > "$ROOT/.swarmforge/roles.tsv"
  for role in "$@"; do
    printf '%s\t%s\t%s\tswarmforge-%s\t%s\tclaude\ttask\n' \
      "$role" "$role" "$ROOT/.worktrees/$role" "$role" "$role" >> "$ROOT/.swarmforge/roles.tsv"
  done
}

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

run_ceremony() {
  ( cd "$ROOT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="QA" "$CEREMONY" "$@" )
}

mailbox_files() {
  { find "$ROOT/.worktrees" -path '*/inbox/new/*' -type f 2>/dev/null
    find "$ROOT/.worktrees/QA/.swarmforge/handoffs/outbox" -maxdepth 1 -type f 2>/dev/null; } | sort
}

clear_mailboxes() {
  find "$ROOT/.worktrees" -path '*/inbox/new/*' -type f -delete 2>/dev/null || true
  find "$ROOT/.worktrees/QA/.swarmforge/handoffs/outbox" -maxdepth 1 -type f -delete 2>/dev/null || true
}

# ═══════════════════════════════════════════════════════════════════════════
# 1. --dry-run prints the draft and reaches no mailbox
# ═══════════════════════════════════════════════════════════════════════════

write_roles coder cleaner architect hardender documenter coordinator specifier QA

DRY="$ROOT/dry.txt"
run_ceremony merge-up --ticket "$TICKET" --commit "$COMMIT_ABBREV" --dry-run > "$DRY"
grep -q '^type: note$' "$DRY" || fail "the dry run did not print a note draft: $(cat "$DRY")"
grep -q "^message: .*$TICKET.*$COMMIT_ABBREV" "$DRY" \
  || fail "the dry run's message names neither the ticket nor the commit: $(cat "$DRY")"
[[ -z "$(mailbox_files)" ]] || fail "--dry-run delivered to a mailbox: $(mailbox_files)"
pass "--dry-run prints the composed draft and sends nothing"

# ═══════════════════════════════════════════════════════════════════════════
# 2. a real send reaches the mailbox through swarm_handoff.sh
# ═══════════════════════════════════════════════════════════════════════════

clear_mailboxes
run_ceremony bookkeep --ticket "$TICKET" --commit "$COMMIT_ABBREV" > "$ROOT/out.txt" 2>"$ROOT/err.txt" \
  || fail "a well-formed bookkeep ceremony was refused: $(cat "$ROOT/err.txt")"

DELIVERED="$(mailbox_files | head -1)"
[[ -n "$DELIVERED" ]] || fail "the bookkeep ceremony reached no mailbox"
# The envelope headers only swarm_handoff.bb stamps: a composer that wrote a
# mailbox itself could not produce them.
# `enqueued_at` is stamped at inbox delivery, so it is absent from a parcel
# still queued in the sender's outbox; the three below are stamped on every
# copy the tool writes, whichever route it took.
for header in id from created_at; do
  grep -q "^${header}: " "$DELIVERED" \
    || fail "the delivered copy has no '${header}:' header - it did not go through swarm_handoff.sh: $(cat "$DELIVERED")"
done
grep -q "^to: coordinator$" "$DELIVERED" || fail "bookkeep did not address the coordinator: $(cat "$DELIVERED")"
[[ "$(basename "$DELIVERED")" == 00_* ]] || fail "the ceremony was not queued at priority 00: $(basename "$DELIVERED")"
pass "a composed ceremony reaches the mailbox through swarm_handoff.sh, tool-stamped"

# ═══════════════════════════════════════════════════════════════════════════
# 3. a send-time refusal reaches the sender with the gate's own words
# ═══════════════════════════════════════════════════════════════════════════

clear_mailboxes
write_roles coder cleaner architect documenter coordinator specifier QA   # no hardender

set +e
run_ceremony merge-up --ticket "$TICKET" --commit "$COMMIT_ABBREV" >"$ROOT/out.txt" 2>"$ROOT/err.txt"
STATUS=$?
set -e

[[ $STATUS -ne 0 ]] || fail "an unknown recipient was accepted"
grep -q "HANDOFF INVALID" "$ROOT/err.txt" \
  || fail "the gate's refusal never reached the sender: $(cat "$ROOT/err.txt")"
grep -q "Unknown recipient role 'hardender'." "$ROOT/err.txt" \
  || fail "the refusal does not say which recipient was unknown: $(cat "$ROOT/err.txt")"
[[ -z "$(mailbox_files)" ]] || fail "a refused ceremony still delivered: $(mailbox_files)"
pass "a send-time refusal reaches the sender unchanged and delivers nothing"

# ═══════════════════════════════════════════════════════════════════════════
# 4. an unknown ceremony name is refused, listing the ones that exist
# ═══════════════════════════════════════════════════════════════════════════

clear_mailboxes
write_roles coder cleaner architect hardender documenter coordinator specifier QA

set +e
run_ceremony merge-sideways --ticket "$TICKET" --commit "$COMMIT_ABBREV" >"$ROOT/out.txt" 2>"$ROOT/err.txt"
STATUS=$?
set -e

[[ $STATUS -ne 0 ]] || fail "an undefined ceremony name was accepted"
for known in merge-up bookkeep spec-ready; do
  grep -q -- "$known" "$ROOT/err.txt" \
    || fail "the refusal does not offer the defined ceremony '$known': $(cat "$ROOT/err.txt")"
done
[[ -z "$(mailbox_files)" ]] || fail "an undefined ceremony still delivered: $(mailbox_files)"
pass "an unknown ceremony name is refused against the defined list"

# ═══════════════════════════════════════════════════════════════════════════
# 5. a missing fact is refused before any send
# ═══════════════════════════════════════════════════════════════════════════

clear_mailboxes
set +e
run_ceremony merge-up --ticket "$TICKET" >"$ROOT/out.txt" 2>"$ROOT/err.txt"
STATUS=$?
set -e

[[ $STATUS -ne 0 ]] || fail "merge-up sent with no commit"
grep -q -- "--commit" "$ROOT/err.txt" || fail "the refusal does not name the missing option: $(cat "$ROOT/err.txt")"
[[ -z "$(mailbox_files)" ]] || fail "a ceremony missing a fact still delivered: $(mailbox_files)"
pass "a ceremony missing one of its facts is refused before any send"

echo "ALL CHECKS PASSED"
