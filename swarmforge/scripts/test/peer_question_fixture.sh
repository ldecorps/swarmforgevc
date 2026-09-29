#!/usr/bin/env bash
# BL-1754: builds the fixture peer_question.bb is driven against for real -
# a throwaway git repo with a roles.tsv, a recording fake `claude` on its
# own bin dir (never PATH-installed globally - the caller prepends the
# printed bin dir to PATH itself), and a pre-existing mailbox parcel + raw
# backlog intake for scenario 03's "touches neither" check. Shared by
# test_peer_question_cli.sh and bl1754PeerQuestionSteps.js, the same
# posture expedite_fixture.sh already takes for the expeditor, so the CLI
# test and the acceptance run exercise the SAME fixture rather than two
# similar ones that drift.
#
# Stock macOS /bin/bash 3.2, not Homebrew bash (this project's own
# guardrail): every array is walked by index (${#arr[@]}/${arr[$i]}), never
# `"${arr[@]}"` directly, so an empty array is never expanded under `set -u`.
#
# Usage: peer_question_fixture.sh <dest-dir> [--to-provider <role>=<provider>]...
# Prints the dest dir on success. Default: one role, "specifier", provider
# "claude" - the Background every BL-1754 scenario shares. Repeat
# --to-provider to add another role's row (scenario 04's aider/local-model
# seats) or to override "specifier"'s own provider.
set -euo pipefail

DEST="${1:?usage: peer_question_fixture.sh <dest-dir> [--to-provider role=provider]...}"
shift || true

PAIRS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-provider)
      PAIRS+=("${2:?--to-provider needs role=provider}")
      shift 2
      ;;
    *)
      echo "peer_question_fixture.sh: unknown argument $1" >&2
      exit 2
      ;;
  esac
done

ROLES=("specifier")
PROVIDERS=("claude")

for ((i = 0; i < ${#PAIRS[@]}; i++)); do
  pair="${PAIRS[$i]}"
  role="${pair%%=*}"
  provider="${pair#*=}"
  replaced=0
  for ((j = 0; j < ${#ROLES[@]}; j++)); do
    if [[ "${ROLES[$j]}" == "$role" ]]; then
      PROVIDERS[$j]="$provider"
      replaced=1
      break
    fi
  done
  if [[ "$replaced" == "0" ]]; then
    ROLES+=("$role")
    PROVIDERS+=("$provider")
  fi
done

mkdir -p "$DEST"
git -C "$DEST" init -q -b main
git -C "$DEST" config user.email "t@t"
git -C "$DEST" config user.name "t"
git -C "$DEST" config commit.gpgsign false
git -C "$DEST" commit -q --allow-empty -m seed

mkdir -p "$DEST/.swarmforge/launch"
: > "$DEST/.swarmforge/roles.tsv"
for ((i = 0; i < ${#ROLES[@]}; i++)); do
  role="${ROLES[$i]}"
  provider="${PROVIDERS[$i]}"
  printf '%s\tmaster\t%s\tswarmforge-%s\t%s\t%s\ttask\n' \
    "$role" "$DEST" "$role" "$role" "$provider" >> "$DEST/.swarmforge/roles.tsv"
  if [[ "$provider" == "claude" ]]; then
    printf '{"model": "claude-opus-5"}\n' > "$DEST/.swarmforge/launch/$role.claude-settings.json"
  fi
done

# scenario 03's "still in its inbox" / "still in the backlog root" fixtures -
# arbitrary content peer_question.bb never reads and must never touch.
mkdir -p "$DEST/.swarmforge/handoffs/specifier/inbox/new" "$DEST/backlog"
printf 'type: git_handoff\nto: specifier\npriority: 50\ntask: fixture-task\ncommit: 0123456789\n' \
  > "$DEST/.swarmforge/handoffs/specifier/inbox/new/fixture.handoff"
printf '# a raw human intake, untouched\n' > "$DEST/backlog/INTAKE-fixture.md"

# The recording fake claude - never installed on the real PATH; the caller
# prepends this bin dir. Records one line per argv element plus an ===END===
# delimiter (so "called exactly once" is a delimiter count); when
# CLAUDE_FAKE_PROMPT_COPY is set, also copies the value that follows
# --append-system-prompt-file there (the real caller deletes its own scratch
# copy in a `finally` right after this script exits, so a test that wants to
# read that file's CONTENT reads this copy instead, never the original path);
# optionally writes its own pid (CLAUDE_FAKE_PIDFILE) and sleeps
# (CLAUDE_FAKE_SLEEP_S) before answering (CLAUDE_FAKE_ANSWER, default "ok")
# and exiting (CLAUDE_FAKE_EXIT, default 0).
BIN_DIR="$DEST/fake-bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/claude" <<'FAKE_CLAUDE'
#!/usr/bin/env bash
: "${CLAUDE_FAKE_LOG:?CLAUDE_FAKE_LOG not set}"
for a in "$@"; do printf '%s\n' "$a" >> "$CLAUDE_FAKE_LOG"; done
printf '===END===\n' >> "$CLAUDE_FAKE_LOG"
if [[ -n "${CLAUDE_FAKE_PROMPT_COPY:-}" ]]; then
  prev=""
  for a in "$@"; do
    if [[ "$prev" == "--append-system-prompt-file" ]]; then
      cp "$a" "$CLAUDE_FAKE_PROMPT_COPY" 2>/dev/null || true
    fi
    prev="$a"
  done
fi
if [[ -n "${CLAUDE_FAKE_PIDFILE:-}" ]]; then
  printf '%s\n' "$$" > "$CLAUDE_FAKE_PIDFILE"
fi
if [[ -n "${CLAUDE_FAKE_SLEEP_S:-}" ]]; then
  sleep "$CLAUDE_FAKE_SLEEP_S"
fi
printf '%s' "${CLAUDE_FAKE_ANSWER:-ok}"
exit "${CLAUDE_FAKE_EXIT:-0}"
FAKE_CLAUDE
chmod +x "$BIN_DIR/claude"

# A fake tmux, same bin dir: scenario 03's "no tmux session is created" needs
# a real binary to observe an invocation against, never the live host's own
# tmux server (this fixture's bin dir is prepended to PATH, ahead of the
# system tmux, by whoever runs the CLI against it). Logs the full invocation
# to TMUX_FAKE_LOG when set; a test asserts that log stays empty/absent.
cat > "$BIN_DIR/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
if [[ -n "${TMUX_FAKE_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$TMUX_FAKE_LOG"
fi
exit 0
FAKE_TMUX
chmod +x "$BIN_DIR/tmux"

echo "$DEST"
