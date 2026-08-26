#!/usr/bin/env bash
# BL-668: fast-forward clean pipeline role branches after QA lands on main.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-.}"
exec bb "$SCRIPT_DIR/post_qa_branch_sweep.bb" "$(cd "$ROOT" && pwd)"
