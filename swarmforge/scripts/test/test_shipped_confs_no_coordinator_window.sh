#!/usr/bin/env bash
# BL-243 bounce (QA, 20260710): parse_config now rejects any `window
# coordinator ...` line, but the original migration (95583ac) only touched
# the live swarmforge/swarmforge.conf - every packs/*.conf, profiles/*.conf,
# and connected-test-pack conf this repo ships still declared one and hard-
# failed at launch (QA reproduced against all 11). Fixed by removing that
# line from every shipped conf; this test is the regression guard QA's own
# evidence doc asked for, so a future new pack/profile can't silently
# reintroduce the gap.
#
# Two checks per file: (1) a static grep - fails loudly and immediately, no
# fixture setup needed, catches ANY future `window coordinator` addition;
# (2) an actual parse_config run against each real file (sourced, not
# executed - BL-089's convention, no real tmux/launch), proving the file
# doesn't just avoid the one keyword but genuinely still launches with
# every role it declares.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

SHIPPED_CONFS=(
  "$REPO_ROOT/swarmforge/packs/two-pack.conf"
  "$REPO_ROOT/swarmforge/packs/two-pack-mistral.conf"
  "$REPO_ROOT/swarmforge/packs/three-pack.conf"
  "$REPO_ROOT/swarmforge/packs/four-pack.conf"
  "$REPO_ROOT/swarmforge/packs/seven-pack.conf"
  "$REPO_ROOT/swarmforge/packs/resilience-min.conf"
  "$REPO_ROOT/swarmforge/profiles/stabilize-two-pack.conf"
  "$REPO_ROOT/swarmforge/profiles/cheap-copilot-seven-pack.conf"
  "$REPO_ROOT/swarmforge/scripts/test/connected/packs/connected-two-pack-claude.conf"
  "$REPO_ROOT/swarmforge/scripts/test/connected/packs/connected-two-pack-mistral.conf"
  "$REPO_ROOT/swarmforge/scripts/test/connected/packs/connected-two-pack-gpt.conf"
)

for conf in "${SHIPPED_CONFS[@]}"; do
  [[ -f "$conf" ]] || fail "expected shipped conf missing entirely: $conf"

  if grep -qE '^window[[:space:]]+coordinator[[:space:]]' "$conf"; then
    fail "$conf still declares a reserved 'window coordinator' line - the coordinator is always auto-provisioned, never conf-declared"
  fi

  # Build a scratch fixture with a role-prompt stub for every role this
  # specific conf actually declares (packs vary widely: 2-pack vs 7-pack,
  # aider vs claude vs copilot) - not a fixed role list.
  fixture_root="$(mktemp -d)"
  mkdir -p "$fixture_root/swarmforge/roles" "$fixture_root/.swarmforge"
  touch "$fixture_root/swarmforge/constitution.prompt"
  while IFS= read -r role; do
    echo "role prompt" > "$fixture_root/swarmforge/roles/$role.prompt"
  done < <(grep -E '^window[[:space:]]' "$conf" | awk '{print $2}' | sort -u)
  cp "$conf" "$fixture_root/swarmforge/swarmforge.conf"

  if ! zsh -c "source '$SWARMFORGE_SH' '$fixture_root'; parse_config" >/tmp/shipped-conf-check.$$.log 2>&1; then
    cat /tmp/shipped-conf-check.$$.log >&2
    rm -f /tmp/shipped-conf-check.$$.log
    rm -rf "$fixture_root"
    fail "$conf failed to parse (see output above) - it should launch cleanly with the auto-provisioned coordinator"
  fi
  rm -f /tmp/shipped-conf-check.$$.log
  rm -rf "$fixture_root"
done

pass "all ${#SHIPPED_CONFS[@]} shipped pack/profile/connected-test confs are free of a reserved 'window coordinator' line and parse cleanly"

echo "ALL PASS"
