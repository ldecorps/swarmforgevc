#!/usr/bin/env bash
# BL-1028: promote_and_route_next.sh must OBEY a commit_integrity_cli.bb
# refusal, never answer it with a raw unlocked `git commit`, and must leave
# the index exactly as it found it when it does not commit.
#
# The old block was `|| { git add -A; git add -u; git commit -m ... }`, which
# fires ONLY when the CLI is present and REFUSED - so its entire job was to
# override refusals, including :lock-timeout and :verify-mismatch, the two
# that mean a concurrent writer is live in the shared master checkout every
# role commits from. And when that fallback also failed, the `git mv` staged
# at the top of the block was left in the index with nothing to unwind it.
#
# Every case here drives the REAL script against a real git fixture, with
# commit_integrity_cli.bb shadowed by a stub that reproduces one refusal
# shape. The two shapes are not the same: a :success-false refusal prints
# JSON on stdout AND a `FAILED (reason)` line on stderr, while a close-guard
# rejection exits before any commit is attempted and prints ONLY a
# `CLOSE BLOCKED` line on stderr, with no JSON at all.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$SCRIPTS/promote_and_route_next.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

BL1028_ROOTS=()
cleanup() {
  local d
  for d in ${BL1028_ROOTS[@]+"${BL1028_ROOTS[@]}"}; do
    [ -n "$d" ] && rm -rf -- "$d"
  done
}
trap cleanup EXIT

TICKET=BL-9028-fixture-ticket.yaml

# A fixture repo with one eligible paused ticket, committed, and a clean
# index. `install_cli` decides which refusal shape (if any) it carries.
mk_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  BL1028_ROOTS+=("$root")

  git -C "$root" init -q
  git -C "$root" config user.email test@test
  git -C "$root" config user.name test
  git -C "$root" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

  mkdir -p "$root/backlog/paused" "$root/backlog/active" "$root/specs/features" "$root/swarmforge/scripts"

  cp "$HELPER" "$root/swarmforge/scripts/promote_and_route_next.sh"
  chmod +x "$root/swarmforge/scripts/promote_and_route_next.sh"
  # promotion_gates (BL-663) is the chokepoint the script shells every gate
  # decision through, and its own load-file chain must travel with the copy:
  # promotion_gates_lib -> backlog_depth_lib -> swarm_identity_lib +
  # daemon_cycle_guard_lib (BL-967). A missing link throws on load and the
  # script reports "no eligible paused ticket", which would look like a
  # promotion decision rather than a broken fixture.
  local dep
  for dep in promotion_gates_cli.bb promotion_gates_lib.bb backlog_depth_lib.bb \
             swarm_identity_lib.bb daemon_cycle_guard_lib.bb; do
    cp "$SCRIPTS/$dep" "$root/swarmforge/scripts/$dep"
  done
  printf 'config active_backlog_max_depth 5\n' > "$root/swarmforge/swarmforge.conf"

  cat > "$root/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
  chmod +x "$root/swarmforge/scripts/route_backlog_to_coder.sh"

  printf 'id: BL-9028\ntitle: "fixture ticket"\nstatus: paused\npriority: 1\nassigned_to:\n' \
    > "$root/backlog/paused/$TICKET"
  : > "$root/specs/features/BL-9028-fixture-ticket.feature"

  git -C "$root" add backlog specs swarmforge
  git -C "$root" commit -q -m "fixture paused backlog"
  # The route log lives OUTSIDE the repo: written inside it, it shows up as an
  # untracked entry and the "index holds nothing staged" assertion would be
  # measuring this harness rather than the script.
  mkdir -p "$root.logs"
  BL1028_ROOTS+=("$root.logs")
  printf '%s\n' "$root"
}

# A stub standing in for commit_integrity_cli.bb. It is invoked as
# `bb <path>`, so it is Babashka, not bash - a bash stub is parsed as Clojure
# and dies on "Invalid keyword", which the script's `||` would then read as an
# ordinary refusal and the case would pass for entirely the wrong reason.
#
# `refusing <reason>` reproduces the :success-false shape (JSON on stdout AND
# a FAILED line on stderr); `close-guard` reproduces the close-guard shape,
# which exits before commit-with-integrity! runs and so prints NO JSON at
# all; `accepting` really commits, as the live CLI does.
install_cli() {
  local root="$1" mode="$2" reason="${3:-}"
  local cli="$root/swarmforge/scripts/commit_integrity_cli.bb"
  case "$mode" in
    refusing)
      cat > "$cli" <<EOF
#!/usr/bin/env bb
(println "{\"success\":false,\"reason\":\"$reason\",\"attempts\":3}")
(binding [*out* *err*]
  (println "commit_integrity_cli: FAILED ($reason) after 3 attempt(s)"))
(System/exit 1)
EOF
      ;;
    close-guard)
      cat > "$cli" <<'EOF'
#!/usr/bin/env bb
(binding [*out* *err*]
  (println "commit_integrity_cli: CLOSE BLOCKED for BL-9028 (missing-qa-approval)."))
(System/exit 1)
EOF
      ;;
    accepting)
      cat > "$cli" <<'EOF'
#!/usr/bin/env bb
(require '[babashka.process :as p])
(let [args (vec *command-line-args*)
      root (first args)
      msg (second (drop-while #(not= "--message" %) args))
      paths (keep-indexed (fn [i a] (when (= "--path" a) (get args (inc i)))) args)]
  (doseq [path paths]
    (p/shell {:continue true :out :string :err :string} "git" "-C" root "add" "-A" "--" path))
  (p/shell {:out :string :err :string} "git" "-C" root "commit" "-q" "-m" msg)
  (println "{\"success\":true,\"attempts\":1}"))
EOF
      ;;
  esac
  chmod +x "$cli"
  # Committed, not left untracked: the "index holds nothing staged" assertion
  # must measure the script's own effect, never this harness's leavings.
  git -C "$root" add -- swarmforge/scripts/commit_integrity_cli.bb
  git -C "$root" commit -q -m "fixture: install stub commit_integrity_cli.bb"
}

run_promotion() {  # root -> combined output, exit code in RC
  local root="$1"
  set +e
  OUT="$(cd "$root" && ROUTE_LOG="$root.logs/route.log" SWARMFORGE_SKIP_DAEMON=1 \
    SWARMFORGE_ROLE=coordinator bash "$root/swarmforge/scripts/promote_and_route_next.sh" 2>&1)"
  RC=$?
  set -e
}

# ═══════════════════════════════════════════════════════════════════════════
# A refused commit is never overridden, and leaves the index as it found it.
# ═══════════════════════════════════════════════════════════════════════════

for case in "refusing lock-timeout" "refusing verify-mismatch" "refusing commit-failed" "close-guard close-guard"; do
  set -- $case
  mode="$1"; reason="$2"
  ROOT="$(mk_root)"
  install_cli "$ROOT" "$mode" "$reason"
  BEFORE="$(git -C "$ROOT" rev-parse HEAD)"
  BEFORE_INDEX="$(git -C "$ROOT" status --porcelain)"
  run_promotion "$ROOT"

  [ "$RC" -ne 0 ] \
    || fail "$reason: the promotion reported SUCCESS after the integrity CLI refused; output: $OUT"

  [ "$(git -C "$ROOT" rev-parse HEAD)" = "$BEFORE" ] \
    || fail "$reason: a commit was created despite the refusal: $(git -C "$ROOT" log --oneline -1)"

  grep -qi -- "$reason" <<< "$OUT" \
    || fail "$reason: the failure report does not name the reason; output: $OUT"

  AFTER_INDEX="$(git -C "$ROOT" status --porcelain)"
  [ "$AFTER_INDEX" = "$BEFORE_INDEX" ] \
    || fail "$reason: the index was left changed - the staged rename survived: [$AFTER_INDEX]"

  [ -f "$ROOT/backlog/paused/$TICKET" ] \
    || fail "$reason: the ticket is not back at its paused path"
  [ ! -e "$ROOT/backlog/active/$TICKET" ] \
    || fail "$reason: the ticket was left at its active path after a refusal"

  [ ! -s "$ROOT.logs/route.log" ] 2>/dev/null \
    || fail "$reason: a refused promotion still routed the ticket onward"

  pass "a $reason refusal: no commit, index unchanged, ticket still paused, failure named"
done

# ═══════════════════════════════════════════════════════════════════════════
# An accepted commit still promotes normally.
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(mk_root)"
install_cli "$ROOT" accepting
BEFORE="$(git -C "$ROOT" rev-parse HEAD)"
run_promotion "$ROOT"

[ "$RC" -eq 0 ] || fail "accepted: the promotion failed; output: $OUT"
[ "$(git -C "$ROOT" rev-parse HEAD)" != "$BEFORE" ] \
  || fail "accepted: no commit was created for the promotion"
[ -f "$ROOT/backlog/active/$TICKET" ] \
  || fail "accepted: the ticket is not at its active path"
[ ! -e "$ROOT/backlog/paused/$TICKET" ] \
  || fail "accepted: the ticket is still at its paused path"
[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || fail "accepted: the index is not clean: [$(git -C "$ROOT" status --porcelain)]"
pass "an accepted integrity commit still promotes normally and leaves a clean index"

# ═══════════════════════════════════════════════════════════════════════════
# A target repo with no integrity CLI still promotes, and SAYS so. Deliberate
# degradation for a target that never had the guard - a fix must not quietly
# delete it, and must not let it look like a guarded commit either.
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(mk_root)"   # no install_cli: the CLI is genuinely absent
[ ! -e "$ROOT/swarmforge/scripts/commit_integrity_cli.bb" ] \
  || fail "absent-cli: the fixture must genuinely have no integrity CLI"
BEFORE="$(git -C "$ROOT" rev-parse HEAD)"
run_promotion "$ROOT"

[ "$RC" -eq 0 ] || fail "absent-cli: the promotion failed; output: $OUT"
[ "$(git -C "$ROOT" rev-parse HEAD)" != "$BEFORE" ] \
  || fail "absent-cli: no commit was created for the promotion"
grep -qi "without the integrity guard" <<< "$OUT" \
  || fail "absent-cli: the promotion did not say it committed without the integrity guard; output: $OUT"
pass "a target with no integrity CLI still promotes and says it committed unguarded"

# ═══════════════════════════════════════════════════════════════════════════
# The rollback is SCOPED. promote_and_route_next.sh runs in the shared master
# checkout every role commits from, so "leaves the index exactly as it found
# it" has a second half the four cases above cannot see: a blanket
# `git reset` would satisfy every one of them while silently discarding work
# another role had staged. These two cases are what make the scoping load-
# bearing rather than incidental.
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(mk_root)"
install_cli "$ROOT" refusing lock-timeout
# Another role's staged work, and an unrelated staged NEW file.
printf 'another role was here\n' >> "$ROOT/specs/features/BL-9028-fixture-ticket.feature"
printf 'brand new\n' > "$ROOT/other-role-new.txt"
git -C "$ROOT" add -- specs/features/BL-9028-fixture-ticket.feature other-role-new.txt
BEFORE_INDEX="$(git -C "$ROOT" status --porcelain)"
run_promotion "$ROOT"

[ "$RC" -ne 0 ] || fail "scoped-rollback: the promotion did not obey the refusal"
AFTER_INDEX="$(git -C "$ROOT" status --porcelain)"
[ "$AFTER_INDEX" = "$BEFORE_INDEX" ] \
  || fail "scoped-rollback: another role's staged work was disturbed; before=[$BEFORE_INDEX] after=[$AFTER_INDEX]"
grep -q "another role was here" "$ROOT/specs/features/BL-9028-fixture-ticket.feature" \
  || fail "scoped-rollback: another role's working-tree edit was discarded"
pass "a refusal rolls back only its own two paths, leaving other roles' staged work untouched"

# And the ticket's OWN path, when it was already staged-but-uncommitted before
# the promotion began. Restoring it to HEAD would look clean to a porcelain
# check that only counts entries, so this asserts the staged CONTENT survives.
ROOT="$(mk_root)"
install_cli "$ROOT" refusing verify-mismatch
printf 'note: staged before promotion\n' >> "$ROOT/backlog/paused/$TICKET"
git -C "$ROOT" add -- "backlog/paused/$TICKET"
BEFORE_INDEX="$(git -C "$ROOT" status --porcelain)"
BEFORE_BLOB="$(git -C "$ROOT" ls-files --stage -- "backlog/paused/$TICKET")"
run_promotion "$ROOT"

[ "$RC" -ne 0 ] || fail "staged-ticket: the promotion did not obey the refusal"
[ "$(git -C "$ROOT" status --porcelain)" = "$BEFORE_INDEX" ] \
  || fail "staged-ticket: the index changed; after=[$(git -C "$ROOT" status --porcelain)]"
[ "$(git -C "$ROOT" ls-files --stage -- "backlog/paused/$TICKET")" = "$BEFORE_BLOB" ] \
  || fail "staged-ticket: the ticket's own staged content was reset to HEAD rather than restored"
grep -q "staged before promotion" "$ROOT/backlog/paused/$TICKET" \
  || fail "staged-ticket: the ticket's pre-promotion edit was discarded from the working tree"
pass "a refusal restores the ticket's own pre-staged index entry, not HEAD's version"

echo "ALL PASS: BL-1028 promotion obeys an integrity refusal"
