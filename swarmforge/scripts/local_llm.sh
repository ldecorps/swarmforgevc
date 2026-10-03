#!/usr/bin/env bash
# BL-1861: thin verb - the contract BL-1863 (operator verbs) calls by this
# exact name and path. All real work lives in local_llm_cli.bb (the HTTP
# unload, the roster surgery, the record); this script only validates argv
# and dispatches.
#
# Usage: local_llm.sh <project-root> remove
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: local_llm.sh <project-root> remove" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage
[[ "$2" == "remove" ]] || usage

exec bb "$SCRIPT_DIR/local_llm_cli.bb" remove "$1"
