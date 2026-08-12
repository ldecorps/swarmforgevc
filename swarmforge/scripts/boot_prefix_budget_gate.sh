#!/usr/bin/env bash
# boot_prefix_budget_gate.sh — fail loud before the specifier commits a
# boot-inlined constitution/article change that pushes the stable boot
# prefix over budget (BL-859).
#
# Usage: boot_prefix_budget_gate.sh [<constitution-tree-root>]
# With no argument, measures the real repo. Exit 0 at or under the 44000-char
# budget, exit 1 above it (with the measured size, budget, and characters to
# move printed to stdout).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bb "$SCRIPT_DIR/boot_prefix_budget_gate.bb" "$@"
