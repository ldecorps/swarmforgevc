#!/usr/bin/env bash
# BL-128: migrate_shared_mailbox.bb moves mail already queued in the old
# shared master inbox into each master-resident role's own new physical
# mailbox, routing by the recipient (inbox states) or sender (outbox/sent/
# failed) header, with an untagged-file fallback to specifier.
#
# Covers acceptance scenario BL-128 mailbox-isolation-05.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATE="$SCRIPT_DIR/../migrate_shared_mailbox.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/.swarmforge"
CODER_WT="$ROOT/.worktrees/coder"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

OLD="$ROOT/.swarmforge/handoffs"
mkdir -p "$OLD/inbox/new" "$OLD/inbox/in_process" "$OLD/inbox/completed" "$OLD/outbox" "$OLD/sent" "$OLD/failed"

printf 'id: x1\nfrom: specifier\nto: coordinator\nrecipient: coordinator\npriority: 50\ntype: note\nmessage: hi\n' \
  > "$OLD/inbox/new/50_x1_for_coordinator.handoff"
printf 'id: x2\nfrom: coordinator\nto: specifier\nrecipient: specifier\npriority: 50\ntype: note\nmessage: hi2\n' \
  > "$OLD/inbox/new/50_x2_for_specifier.handoff"
printf 'id: x3\nfrom: coordinator\nto: coder\npriority: 50\ntype: note\nmessage: notag\n' \
  > "$OLD/inbox/new/50_x3_untagged.handoff"
printf 'id: x4\nfrom: coordinator\nto: specifier\npriority: 50\ntype: note\nmessage: outbound\n' \
  > "$OLD/outbox/50_x4_from_coordinator.handoff"
echo "000042" > "$OLD/sequence"

# ── dry-run makes no changes ──────────────────────────────────────────────
bb "$MIGRATE" "$ROOT" --dry-run > /dev/null
[[ -f "$OLD/inbox/new/50_x1_for_coordinator.handoff" ]] \
  || fail "dry-run moved a file out of the old shared inbox"
[[ ! -d "$ROOT/.swarmforge/handoffs/coordinator" ]] \
  || fail "dry-run created the new coordinator mailbox tree"
pass "dry-run makes no filesystem changes"

# ── real run routes by recipient/sender header ────────────────────────────
OUT="$(bb "$MIGRATE" "$ROOT")"

[[ -f "$ROOT/.swarmforge/handoffs/coordinator/inbox/new/50_x1_for_coordinator.handoff" ]] \
  || fail "recipient-tagged file for coordinator was not migrated to coordinator's own mailbox"
[[ -f "$ROOT/.swarmforge/handoffs/specifier/inbox/new/50_x2_for_specifier.handoff" ]] \
  || fail "recipient-tagged file for specifier was not migrated to specifier's own mailbox"
pass "recipient-tagged inbox files migrate to the correct role's own mailbox"

[[ -f "$ROOT/.swarmforge/handoffs/specifier/inbox/new/50_x3_untagged.handoff" ]] \
  || fail "a file whose recipient isn't master-resident did not fall back to specifier"
grep -q "no recognized recipient" <<< "$OUT" \
  || fail "no warning was logged for the untagged/unrecognized-recipient file"
pass "an untagged/unrecognized recipient falls back to specifier's mailbox with a logged warning"

[[ -f "$ROOT/.swarmforge/handoffs/coordinator/outbox/50_x4_from_coordinator.handoff" ]] \
  || fail "sender-tagged outbox file was not migrated to the sender's own outbox"
pass "outbox/sent/failed migrate by the file's own sender (from:) header"

[[ -f "$ROOT/.swarmforge/handoffs/coordinator/sequence" ]] \
  || fail "coordinator's sequence counter was not seeded from the old shared counter"
[[ -f "$ROOT/.swarmforge/handoffs/specifier/sequence" ]] \
  || fail "specifier's sequence counter was not seeded from the old shared counter"
[[ "$(cat "$ROOT/.swarmforge/handoffs/coordinator/sequence")" == "000042" ]] \
  || fail "coordinator's seeded sequence value does not match the old shared counter"
pass "the shared sequence counter is copied to seed each role's own counter"

[[ -f "$OLD/sequence" ]] || fail "the old sequence file was deleted instead of left in place"
pass "the old shared tree is left in place (never deleted), only its files moved"

# ── idempotent: a second run has nothing left to migrate ──────────────────
OUT2="$(bb "$MIGRATE" "$ROOT")"
grep -q "Migrated: {}" <<< "$OUT2" \
  || fail "second run found leftover files to migrate; got: $OUT2"
pass "running the migration a second time is a no-op"

echo "ALL PASS"
