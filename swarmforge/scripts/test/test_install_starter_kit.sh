#!/usr/bin/env bash
# BL-1758: install_starter_kit.bb - the pure "already has a tree" refusal
# and the copied-file set, against throwaway fixture roots.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/../install_starter_kit.bb"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_root() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

# 01: a README-only target gets the whole kit, exit 0.
ROOT1="$(make_root)"
echo "hello" > "$ROOT1/README.md"
OUT1="$(bb "$INSTALLER" "$ROOT1" my-swarm 2>&1)"
RC1=$?
[[ "$RC1" -eq 0 ]] || fail "01: expected exit 0, got $RC1: $OUT1"
[[ -d "$ROOT1/swarmforge/scripts" ]] || fail "01: expected swarmforge/scripts"
[[ -d "$ROOT1/swarmforge/git-hooks" ]] || fail "01: expected swarmforge/git-hooks"
[[ -f "$ROOT1/swarmforge/packs/mono-router.conf" ]] || fail "01: expected the mono-router pack"
[[ -f "$ROOT1/swarmforge/roles/coder.prompt" ]] || fail "01: expected a generic coder role prompt"
pass "01: a README-only target receives the whole kit"

# 01b: nested subdirectories of swarmforge/scripts (load-bearing at launch -
#      swarmforge.sh's ensure_terminal_adapter requires terminal-adapters/
#      to exist and be executable) are copied too, not just its top-level
#      files. A non-recursive copy would pass every other check above
#      (scripts/ as a directory exists, scripts/swarmforge.sh exists) while
#      silently dropping every nested directory - hand-verified: mutating
#      copy-tree!'s glob from "**" to "*" left every existing case above
#      green.
[[ -f "$ROOT1/swarmforge/scripts/terminal-adapters/none.sh" ]] \
  || fail "01b: expected a nested terminal-adapters/ file to be copied (non-recursive copy regression)"
pass "01b: nested scripts/ subdirectories are copied, not just top-level files"

# 02: the written conf names the checkout and the given swarm name.
grep -q "^config swarm_name my-swarm\$" "$ROOT1/swarmforge/swarmforge.conf" \
  || fail "02: expected config swarm_name my-swarm in the written conf"
grep -q "^config tooling_root " "$ROOT1/swarmforge/swarmforge.conf" \
  || fail "02: expected a config tooling_root line"
pass "02: the conf names the swarm and the checkout"

# 03: an existing swarmforge/ tree is refused, and left untouched.
ROOT3="$(make_root)"
mkdir -p "$ROOT3/swarmforge"
echo "pre-existing" > "$ROOT3/swarmforge/sentinel.txt"
BEFORE_SUM="$(find "$ROOT3" -type f -exec sha256sum {} \; | sort)"
OUT3="$(bb "$INSTALLER" "$ROOT3" my-swarm 2>&1)"
RC3=$?
[[ "$RC3" -ne 0 ]] || fail "03: expected a non-zero exit, got 0"
[[ "$OUT3" == *swarmforge* ]] || fail "03: expected the refusal to name the swarmforge directory, got: $OUT3"
AFTER_SUM="$(find "$ROOT3" -type f -exec sha256sum {} \; | sort)"
[[ "$BEFORE_SUM" == "$AFTER_SUM" ]] || fail "03: expected the target untouched on refusal"
pass "03: an existing swarmforge tree is refused, untouched"

# 04: no engineering.prompt/local-engineering.prompt/project.prompt/reference/
#     from this checkout ever reaches the target.
ROOT4="$(make_root)"
echo "hello" > "$ROOT4/README.md"
bb "$INSTALLER" "$ROOT4" my-swarm >/dev/null 2>&1
for f in project.prompt engineering.prompt local-engineering.prompt; do
  [[ ! -f "$ROOT4/swarmforge/constitution/$f" ]] || fail "04: expected no $f copied"
done
[[ ! -d "$ROOT4/swarmforge/constitution/articles/reference" ]] || fail "04: expected no reference/ directory copied"
pass "04: no swarmforgevc-specific prose is copied"

# 05: missing required args exits 2 with a usage message, writes nothing.
ROOT5="$(make_root)"
OUT5="$(bb "$INSTALLER" "$ROOT5" 2>&1)"
RC5=$?
[[ "$RC5" -eq 2 ]] || fail "05: expected exit 2 for a missing swarm-name arg, got $RC5"
[[ ! -d "$ROOT5/swarmforge" ]] || fail "05: expected nothing written on a usage error"
pass "05: a missing argument exits 2 and writes nothing"

echo "ALL PASS"
