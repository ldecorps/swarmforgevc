#!/usr/bin/env bash
# Merge absolute paths into ~/.copilot/config.json trustedFolders so headless
# swarm agents skip the "Yes / remember this folder" startup prompt.
set -euo pipefail

if (( $# == 0 )); then
  exit 0
fi

python3 - "$@" <<'PY'
import json
import os
import sys
from pathlib import Path

config_path = Path.home() / ".copilot" / "config.json"
incoming = [os.path.realpath(p) for p in sys.argv[1:] if p.strip()]

header = ""
raw = ""
if config_path.is_file():
    raw = config_path.read_text(encoding="utf-8")
    body_lines = []
    for line in raw.splitlines():
        if line.strip().startswith("//"):
            header += line + "\n"
        else:
            body_lines.append(line)
    data = json.loads("\n".join(body_lines) or "{}")
else:
    header = (
        "// User settings belong in settings.json.\n"
        "// This file is managed automatically.\n"
    )
    data = {}

trusted = list(data.get("trustedFolders") or [])
seen = set(trusted)
added = []
for path in incoming:
    if path not in seen:
        trusted.append(path)
        seen.add(path)
        added.append(path)

if not added:
    sys.exit(0)

data["trustedFolders"] = trusted
config_path.parent.mkdir(parents=True, exist_ok=True)
with config_path.open("w", encoding="utf-8") as fh:
    fh.write(header)
    json.dump(data, fh, indent=2)
    fh.write("\n")

for path in added:
    print(f"copilot trusted folder: {path}")
PY
