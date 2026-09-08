#!/usr/bin/env bash
# BL-1480: a minimal stand-in for extension/out/tools/deprecate-check.js,
# for fixtures that run the real promote_and_route_next.sh against a
# disposable root.
#
# BL-1173 (2026-08-27) added a fail-closed deprecator freshness gate between
# candidate pick and git-mv: promote_and_route_next.sh resolves $ROOT (the
# fixture root here) and looks for extension/out/tools/deprecate-check.js
# there. When it is absent, both call sites (the CLI consult AND the
# interpretFreshnessCliOutput require) fail closed to "hold", and the
# candidate never leaves backlog/paused/ - a real production dependency the
# two `promote_and_route_next` fixtures never accounted for, because they
# predate BL-1173 by three weeks and neither exercised a real promotion
# again until BL-1480 fixed their unrelated bb-closure rot.
#
# Dragging the real deprecate-check.js in is not practical here: it requires
# a working extension/out/ tree (compiled TypeScript, its own require graph -
# `./swarm-metrics` and further from there), which these lightweight shell
# fixtures have no way to build or copy piecemeal. What promote_and_route_next.sh
# actually needs from this path, at both call sites, is narrow and stable:
#   - run directly (`node <path> <root> <id>`): print one JSON line, exit 0.
#   - `require`d: export interpretFreshnessCliOutput(raw), the same pure
#     parse-and-classify contract documented in
#     extension/src/tools/deprecate-check.ts (BL-1173 inv 1).
# This fake reproduces exactly that pair, not the freshness EVALUATION the
# real CLI performs - these fixtures test priority ordering and the
# no-limit depth sentinel, not the deprecator, the same "stand in for the
# thing downstream of what this test verifies" posture already used here for
# route_backlog_to_coder.sh.
#
# Usage:
#   source "$SCRIPT_DIR/lib/deprecate_check_allow_stub.sh"
#   write_deprecate_check_allow_stub "$ROOT"

write_deprecate_check_allow_stub() {
  local root="${1:?write_deprecate_check_allow_stub: fixture root}"
  mkdir -p "$root/extension/out/tools"
  cat > "$root/extension/out/tools/deprecate-check.js" <<'EOF'
'use strict';
// BL-1480 fixture stub - see swarmforge/scripts/test/lib/deprecate_check_allow_stub.sh
function interpretFreshnessCliOutput(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && parsed.decision === 'allow') {
      return { decision: 'allow' };
    }
  } catch (e) {
    // fall through to hold
  }
  return { decision: 'hold', reason: 'BL-1480 fixture stub: unexpected deprecate-check input' };
}
module.exports = { interpretFreshnessCliOutput };
if (require.main === module) {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}
EOF
}
