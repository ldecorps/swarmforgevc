#!/usr/bin/env bash
# BL-560 (epic BL-558 slice 1): scheduled scan that intakes any open GitHub
# issue lacking a swarm-intake/swarm-specced label and lacking an existing
# backlog/GH-<n>-*.yaml file on main, writing/committing it via the SAME
# shared writer (github_intake_write.sh) the label-triggered swarm-intake.yml
# workflow already uses - never a second YAML shape.
#
# Run from the checked-out repo root, with `gh`/`git` on PATH and a token
# gh can authenticate with (GH_TOKEN/GITHUB_TOKEN env - the workflow routes
# secrets.GITHUB_TOKEN into env:, never into this script's own text).
#
# gh's OWN --jq (bundled with the gh binary - no system `jq` install
# required, matching what's actually preinstalled on GitHub-hosted runners
# vs. this repo's dev sandboxes) shapes each candidate issue into one line,
# fields separated by \x1f (ASCII unit separator): number, url,
# comma-joined label names, base64 title, base64 body. Base64 keeps an
# arbitrary multi-line issue title or body from corrupting the
# line-oriented read loop below. \x1f, not a tab, because bash's `read`
# treats tab (like space/newline) as IFS *whitespace* - collapsing runs of
# it and swallowing an empty field between two tabs - even when IFS is set
# to nothing but a lone tab; an issue with no labels (empty labels_csv
# field) silently shifted every later field left by one under a tab
# delimiter. \x1f carries no such special-casing, so a genuinely empty
# field between two delimiters is preserved.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_NAME="${GITHUB_INTAKE_BOT_NAME:-swarm-intake[bot]}"
BOT_EMAIL="${GITHUB_INTAKE_BOT_EMAIL:-swarm-intake@users.noreply.github.com}"

existing_file_for_issue() {
  compgen -G "backlog/GH-${1}-*.yaml" 2>/dev/null | head -n1 || true
}

has_label() {
  local labels_csv="$1" label="$2"
  [[ ",${labels_csv}," == *",${label},"* ]]
}

git config user.name "$BOT_NAME"
git config user.email "$BOT_EMAIL"

gh issue list --state open --limit 100 --json number,title,body,url,labels \
  --jq '.[] | [(.number|tostring), .url, ([.labels[].name] | join(",")), (.title | @base64), ((.body // "") | @base64)] | join("\u001f")' \
| while IFS=$'\x1f' read -r num url labels_csv title_b64 body_b64; do
    if has_label "$labels_csv" "swarm-intake" || has_label "$labels_csv" "swarm-specced"; then
      echo "SKIP: GH-${num} already labeled (swarm-intake or swarm-specced)"
      continue
    fi

    if [[ -n "$(existing_file_for_issue "$num")" ]]; then
      echo "SKIP: GH-${num} already has a backlog file"
      continue
    fi

    title="$(printf '%s' "$title_b64" | base64 -d)"
    body="$(printf '%s' "$body_b64" | base64 -d)"

    file="$(bash "$SCRIPT_DIR/github_intake_write.sh" "$num" "$title" "$body" "$url")"

    git add "$file"
    # Two scheduled runs (or a scheduled run racing the label-triggered
    # workflow) can land on main between checkout and push - rebase with
    # autostash so parallel GH-* files compose cleanly instead of failing
    # push (same race-fix swarm-intake.yml's own Commit step already uses).
    git pull --rebase --autostash origin main
    if git diff --cached --quiet; then
      echo "Intake file already on main; skipping commit for GH-${num}"
      continue
    fi
    git commit -q -m "Scheduled intake GH-${num} to backlog root

From issue: ${url}"
    git push origin main

    gh issue comment "$num" --body "Queued for the swarm: \`$file\` on \`main\`. The specifier drains backlog-root items first at next restart." >/dev/null
    gh issue edit "$num" --add-label "swarm-intake" >/dev/null
    echo "OK: intaked GH-${num} -> $file"
  done
