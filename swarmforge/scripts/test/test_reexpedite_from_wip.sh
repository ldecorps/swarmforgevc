#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../reexpedite_from_wip.sh"
fail=0

check() {
  if eval "$2"; then
    printf 'ok   - %s\n' "$1"
  else
    printf 'FAIL - %s\n' "$1"
    fail=1
  fi
}

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.name "Reexpedite Test"
git -C "$ROOT" config user.email "reexpedite@example.test"
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/backlog/active"
cp "$SCRIPT" "$ROOT/swarmforge/scripts/reexpedite_from_wip.sh"
cat > "$ROOT/swarmforge/scripts/expedite_with_progress.sh" <<'EOF'
#!/usr/bin/env bash
printf 'expedite %s\n' "$*" >> "$1/expedite-called.log"
EOF
chmod +x "$ROOT/swarmforge/scripts/"*.sh
printf 'id: BL-696\n' > "$ROOT/backlog/active/BL-696-test.yaml"
git -C "$ROOT" add .
git -C "$ROOT" commit -qm "fixture"
printf 'changed\n' > "$ROOT/wip.txt"
mkdir -p "$ROOT/node_modules"
printf 'do not commit\n' > "$ROOT/node_modules/huge.js"

OUT="$(REEXPEDITE_SKIP_PREFLIGHT=1 bash "$ROOT/swarmforge/scripts/reexpedite_from_wip.sh" "$ROOT" BL-696)"

check "checkpoint commit contains WIP" \
  'git -C "$ROOT" show --name-only --format= HEAD | grep -qx wip.txt'
check "checkpoint excludes root node_modules" \
  '! git -C "$ROOT" ls-files --error-unmatch node_modules/huge.js >/dev/null 2>&1'
check "expedite wrapper is invoked for the ticket" \
  'grep -q "BL-696" "$ROOT/expedite-called.log"'
check "output reports checkpoint and relaunch" \
  '[[ "$OUT" == *"checkpoint committed"* && "$OUT" == *"relaunching BL-696"* ]]'

DRY_ROOT="$(mktemp -d)"
register_tmp_dir "$DRY_ROOT"
git -C "$DRY_ROOT" init -q -b main
git -C "$DRY_ROOT" config user.name "Reexpedite Test"
git -C "$DRY_ROOT" config user.email "reexpedite@example.test"
mkdir -p "$DRY_ROOT/swarmforge/scripts"
cp "$SCRIPT" "$DRY_ROOT/swarmforge/scripts/"
touch "$DRY_ROOT/keep.txt"
git -C "$DRY_ROOT" add .
git -C "$DRY_ROOT" commit -qm "fixture"
printf 'dirty\n' >> "$DRY_ROOT/keep.txt"

DRY="$(REEXPEDITE_DRY_RUN=1 bash "$DRY_ROOT/swarmforge/scripts/reexpedite_from_wip.sh" "$DRY_ROOT" BL-696)"
check "dry-run describes destructive steps" \
  '[[ "$DRY" == *"stop active expedite"* && "$DRY" == *"remove worktree"* && "$DRY" == *"checkpoint current WIP"* ]]'
check "dry-run leaves WIP uncommitted" \
  '[[ -n "$(git -C "$DRY_ROOT" status --porcelain)" ]]'

exit "$fail"
