#!/usr/bin/env bash
# BL-518: mono-router rotation. Thin wrapper so the resident agent rotates
# with the same `./<script>.sh` idiom every other handoff helper uses.
# Usage: rotate_to_role.sh <role>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bb "$DIR/rotate_to_role.bb" "$@"
