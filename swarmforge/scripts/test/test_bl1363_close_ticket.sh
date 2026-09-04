#!/usr/bin/env bash
# BL-1363 e2e: closing a ticket is one command, through the SAME integrity path
# promotion uses, obeying a refusal, and moving every id an approval satisfies
# or none (Article 2.6).
#
# BL-1242: independent guards must NOT run under `set -e`.
# BL-1390: every git call goes through a guard that PROVES the target is under
# this test's own temp root - `git -C ""` uses the current directory, and this
# suite's sibling once rewrote the live repository's origin that way.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLOSE="$SCRIPT_DIR/../close_ticket.sh"
PROMOTE="$SCRIPT_DIR/../promote_and_route_next.sh"
FIXTURE_PREFIX="bl1363-close-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

rm -rf "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}"* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT

LIVE_ORIGIN_BEFORE="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)"

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  # The one raw git call in this file: the guard's own question.
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in
    /*) [[ "$common" == "$WORK"/* ]] || return 1 ;;
    *)  : ;;
  esac
  return 0
}
g() {
  in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }
  git -C "$1" "${@:2}"
}
gq() { g "$@" >/dev/null 2>&1; }

ticket_yaml() {
  printf 'id: %s\ntitle: fixture\nmilestone: %s\nstatus: todo\nassigned_to: coder\n' "$1" "$2"
}

setup() {
  name="$1"; root="$WORK/$name"
  mkdir -p "$root/backlog/active" "$root/backlog/paused" "$root/backlog/done" "$root/swarmforge/scripts"
  git init -q -b main "$root"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do
    g "$root" config "${kv%%:*}" "${kv##*:}" >/dev/null
  done
  cp -R "$REPO_ROOT/swarmforge/scripts/." "$root/swarmforge/scripts/" \
    || fail "setup($name): could not copy scripts"
  ticket_yaml BL-9001 M8 > "$root/backlog/active/BL-9001-first.yaml"
  ticket_yaml BL-9002 M8 > "$root/backlog/active/BL-9002-second.yaml"
  ticket_yaml BL-9003 M7 > "$root/backlog/paused/BL-9003-paused.yaml"
  # The close guard (ticket_close_guard_lib.bb) refuses a close with no QA
  # approval on record - correctly, and the whole point of committing through
  # the integrity path. The fixture therefore provides what a real close has:
  # a coordinator mailbox carrying QA's own note naming these tickets.
  mkdir -p "$root/.swarmforge/handoffs/coordinator/inbox/completed" \
           "$root/.swarmforge/handoffs/coordinator/inbox/new" \
           "$root/.swarmforge/handoffs/coordinator/inbox/in_process"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  printf 'from: QA\ntype: note\npriority: 00\nmessage: BL-9001 BL-9002 QA-approved -- coordinator bookkeep\n\nBL-9001 BL-9002 QA-approved\n' \
    > "$root/.swarmforge/handoffs/coordinator/inbox/completed/00_qa_approval.handoff"
  gq "$root" add -A && gq "$root" commit -m "seed" || fail "setup($name): seed failed"
}

# The fixture's OWN copy: close_ticket.sh resolves its helpers from its own
# location, so running this repository's copy would consult this repository's
# integrity CLI and scenario 2's stub would never be reached. Output goes
# outside $root so the fixture's own tree stays clean for the dirt assertions.
run_close() {
  ( cd "$root" && bash "$root/swarmforge/scripts/close_ticket.sh" "$root" "$@" \
      2>"$WORK/$name.close.err" >"$WORK/$name.close.out" )
}
close_err() { cat "$WORK/$name.close.err" 2>/dev/null; }
close_out() { cat "$WORK/$name.close.out" 2>/dev/null; }

# ── 1. one approved ticket, moved and committed through the integrity path ──
setup one
run_close BL-9001
if [[ -f "$root/backlog/done/M8/BL-9001-first.yaml" ]]; then
  pass "the ticket file is in the done area for its milestone"
else
  fail "not in backlog/done/M8/: $(ls "$root/backlog/done" 2>/dev/null); err: $(cat "$WORK/$name.close.err")"
fi
if g "$root" log -1 --format=%s | grep -q "Close BL-9001: move to done"; then
  pass "the move is committed in one step with a generated subject"
else
  fail "unexpected commit subject: $(g "$root" log -1 --format=%s)"
fi
# The integrity path is the one promotion uses: the commit exists and the
# script printed the CLI's own output rather than a hand-rolled commit.
if grep -q 'commit_integrity\|"success"' "$WORK/$name.close.out" "$WORK/$name.close.err" 2>/dev/null; then
  pass "the commit went through the integrity CLI, whose output is passed through"
else
  fail "no integrity CLI output: $(head -3 "$WORK/$name.close.out" "$WORK/$name.close.err" 2>/dev/null)"
fi
if [[ -z "$(g "$root" status --porcelain 2>/dev/null)" ]]; then
  pass "nothing else was left staged or dirty"
else
  fail "the tree is dirty after a close: $(g "$root" status --porcelain)"
fi

# ── 2. a refused integrity check changes nothing ───────────────────────────
setup two
# Force a refusal the way the CLI itself would: replace it with one that
# refuses in the CLI's own :success-false shape.
cat > "$root/swarmforge/scripts/commit_integrity_cli.bb" <<'BB'
#!/usr/bin/env bb
(println "{\"success\":false,\"reason\":\"fixture-refusal\"}")
(binding [*out* *err*] (println "FAILED (fixture-refusal)"))
(System/exit 1)
BB
gq "$root" add -A && gq "$root" commit -m "fixture: stub the integrity CLI to refuse"
run_close BL-9001
if [[ -f "$root/backlog/active/BL-9001-first.yaml" ]]; then
  pass "a refused close leaves the ticket in the active area"
else
  fail "the ticket moved despite a refusal"
fi
if [[ -z "$(g "$root" status --porcelain 2>/dev/null)" ]]; then
  pass "and nothing is left staged in the shared index (BL-1028)"
else
  fail "the refusal left the index dirty: $(g "$root" status --porcelain)"
fi
if grep -q "fixture-refusal" "$WORK/$name.close.err"; then
  pass "and the refusal reason is reported"
else
  fail "the refusal reason was not reported: $(cat "$WORK/$name.close.err")"
fi

# ── 3. every ticket one approval satisfies closes together (Article 2.6) ───
setup three
run_close BL-9001 BL-9002
if [[ -f "$root/backlog/done/M8/BL-9001-first.yaml" && -f "$root/backlog/done/M8/BL-9002-second.yaml" ]]; then
  pass "both tickets are in the done area for their milestone"
else
  fail "a multi-ticket close moved only some: $(ls "$root/backlog/done/M8" 2>/dev/null)"
fi
if g "$root" log -1 --format=%s | grep -q "BL-9001" && g "$root" log -1 --format=%s | grep -q "BL-9002"; then
  pass "and the commit subject names EVERY id the approval satisfied"
else
  fail "the subject does not name both ids: $(g "$root" log -1 --format=%s)"
fi

# ── 4. a partial close is refused rather than half-applied ────────────────
setup four
run_close BL-9001 BL-9404
if [[ -f "$root/backlog/active/BL-9001-first.yaml" ]]; then
  pass "neither ticket moved when one of them could not be closed"
else
  fail "a partial close was applied: BL-9001 moved while BL-9404 could not"
fi
if grep -q "BL-9404" "$WORK/$name.close.err"; then
  pass "and the refusal names the ticket that blocked it"
else
  fail "the refusal does not name the blocker: $(cat "$WORK/$name.close.err")"
fi

# ── 5. closing never promotes ──────────────────────────────────────────────
setup five
run_close BL-9001
if [[ -f "$root/backlog/paused/BL-9003-paused.yaml" && ! -f "$root/backlog/active/BL-9003-paused.yaml" ]]; then
  pass "no paused ticket was promoted by a close"
else
  fail "a close promoted a paused ticket"
fi

# ── 6. the shared checkout's unrelated dirt is not swept in (BL-506) ──────
setup six
echo "someone else's work" > "$root/unrelated.txt"
gq "$root" add "unrelated.txt"
echo "and an unstaged edit" > "$root/backlog/paused/BL-9003-paused.yaml"
run_close BL-9001
# --no-renames: git records the move as a RENAME, so the default output shows
# one path and an assertion on two would fail against a correct close. What
# matters is that NOTHING outside this ticket is in the commit.
touched="$(g "$root" show --name-only --no-renames --format= HEAD 2>/dev/null | sed '/^$/d' | sort)"
foreign="$(grep -v 'BL-9001-first\.yaml' <<<"$touched")"
if [[ -z "$foreign" && -n "$touched" ]]; then
  pass "the close commit contains only its own ticket's paths (BL-506)"
else
  fail "the close swept in other paths: $(tr '\n' ' ' <<<"$foreign")"
fi
if g "$root" status --porcelain | grep -q "unrelated.txt"; then
  pass "and the unrelated staged work is still there, untouched"
else
  fail "the close consumed another writer's staged work"
fi

# ── the suite left the live repository alone (BL-1390's lesson) ────────────
if [[ "$LIVE_ORIGIN_BEFORE" == "$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)" ]]; then
  pass "the live repository's origin URL is byte-identical after the suite"
else
  fail "the suite changed the live origin URL"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
