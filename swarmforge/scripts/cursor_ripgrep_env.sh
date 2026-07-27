#!/usr/bin/env bash
# Resolve CURSOR_RIPGREP_PATH for headless Cursor SDK local agents.
# Cursor upgrades can remove an old ~/.cursor-server/bin/<hash>/ tree while the
# SDK still points at it — export a working rg before spawning bridge processes.

resolve_cursor_ripgrep_path() {
  local root="${1:-.}"

  if [[ -n "${CURSOR_RIPGREP_PATH:-}" && -x "${CURSOR_RIPGREP_PATH}" ]]; then
    export CURSOR_RIPGREP_PATH
    return 0
  fi

  local sdk_rg="${root}/extension/node_modules/@cursor/sdk-linux-x64/bin/rg"
  if [[ -x "$sdk_rg" ]]; then
    export CURSOR_RIPGREP_PATH="$sdk_rg"
    return 0
  fi

  if [[ -n "${HOME:-}" ]]; then
    local server_rg=""
    for candidate in "${HOME}"/.cursor-server/bin/*/node_modules/@vscode/ripgrep/bin/rg; do
      [[ -x "$candidate" ]] || continue
      server_rg="$candidate"
    done
    if [[ -n "$server_rg" ]]; then
      export CURSOR_RIPGREP_PATH="$server_rg"
      return 0
    fi
  fi

  echo "resolve_cursor_ripgrep_path: no executable rg found (set CURSOR_RIPGREP_PATH)" >&2
  return 1
}
