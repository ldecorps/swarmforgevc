#!/usr/bin/env bash
# BL-982: SEAT vs STAGE identity. A pack may declare a second seat for a
# stage as <stage>@<seat>; the seat owns session/worktree/launch-script/
# settings identity while the prompt (parse-time existence check AND
# PromptEngine composition) keys on the stage. Same "source + explicit
# function calls, never the real tmux launch" pattern as
# test_backlog_depth_pack_override.sh (BL-089 ZSH_EVAL_CONTEXT guard).
#
# Case 7 is the byte-identity check for BL-982 invariant 2: a single-seat
# pack's roles.tsv must be byte-identical between THIS worktree's script
# and the pre-change script extracted from git HEAD~ (the generative
# sweep over many confs lives in bl982_multi_seat_identity_property_runner.bb;
# this is the fixed-conf anchor).

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts"
  touch "$root/swarmforge/constitution.prompt"
  for role in coordinator specifier coder; do
    echo "distinctive-$role-prompt-body" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

run_parse() {
  # parse + roles.tsv, no launch. Callers pass the root.
  env -u SWARMFORGE_CONFIG XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$1'; parse_config; write_roles_file"
}

# ── 1: a two-seat stage parses and both seats land in roles.tsv under their
#      own seat ids, sessions and worktrees ────────────────────────────────
ROOT1="$(mk_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
window specifier claude master --model claude-opus-5
window coder claude coder --model claude-sonnet-5
window coder@fable claude coder-fable --model claude-fable-5
CONF
run_parse "$ROOT1" || fail "1: two-seat pack failed to parse"
TSV1="$ROOT1/.swarmforge/roles.tsv"
grep -q "^coder	coder	" "$TSV1" || fail "1: bare coder seat row missing"
grep -q "^coder@fable	coder-fable	" "$TSV1" || fail "1: coder@fable seat row missing"
[ "$(cut -f4 "$TSV1" | sort -u | wc -l | tr -d ' ')" = "4" ] || fail "1: sessions not distinct per seat (incl coordinator)"
grep -q "swarmforge-coder@fable" "$TSV1" || fail "1: seat session not derived from seat id"
pass "1: two seats of one stage parse into distinct seat-keyed rows"

# ── 2: provisioning artifacts are seat-keyed; the composed prompt is
#      stage-keyed (both seats carry the stage's prompt body) ──────────────
ART2="$(env -u SWARMFORGE_CONFIG XDG_RUNTIME_DIR=/tmp zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  i_bare=\$(( \${ROLE_INDEX[coder]} + 1 ))
  i_seat=\$(( \${ROLE_INDEX[coder@fable]} + 1 ))
  generate_dormant_role_launch_artifacts \$i_bare
  generate_dormant_role_launch_artifacts \$i_seat
  echo OK
")" || fail "2: artifact generation failed: $ART2"
LAUNCH_DIR="$ROOT1/.swarmforge/launch"
PROMPTS_DIR1="$ROOT1/.swarmforge/prompts"
[ -f "$LAUNCH_DIR/coder.sh" ] || fail "2: bare seat launch script missing"
[ -f "$LAUNCH_DIR/coder@fable.sh" ] || fail "2: second seat launch script missing"
# PromptEngine composes from ITS repo's own roles dir (SCRIPT_DIR-relative,
# not the fixture root), so the stage-keyed claim is asserted through the
# compose metadata's own "role" field plus the real stage prompt text.
grep -q '"role":"coder"' "$PROMPTS_DIR1/coder.md.metadata.json" || fail "2: bare seat did not compose as stage 'coder'"
grep -q '"role":"coder"' "$PROMPTS_DIR1/coder@fable.md.metadata.json" || fail "2: second seat did not compose as stage 'coder' (stage-keyed composition)"
grep -q "You are the coder" "$PROMPTS_DIR1/coder@fable.md" || fail "2: second seat's composed prompt is not the coder stage prompt"
pass "2: seat-keyed launch scripts, stage-keyed prompt composition"

# ── 3: each seat carries the model from its OWN window line ───────────────
grep -q "claude-sonnet-5" "$LAUNCH_DIR/coder.claude-settings.json" || fail "3: bare seat lost its own model"
grep -q "claude-fable-5" "$LAUNCH_DIR/coder@fable.claude-settings.json" || fail "3: second seat lost its own model"
grep -q "claude-sonnet-5" "$LAUNCH_DIR/coder@fable.claude-settings.json" && fail "3: second seat leaked the bare seat's model"
grep -q '"model":"claude-fable-5"' "$PROMPTS_DIR1/coder@fable.md.metadata.json" || fail "3: second seat's compose metadata lost its own model"
pass "3: per-seat model rides each seat's own window line"

# ── 4: duplicate seat id still refused, naming it ─────────────────────────
ROOT4="$(mk_root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
window coder@fable claude coder-a --model x
window coder@fable claude coder-b --model x
CONF
OUT4="$(run_parse "$ROOT4" 2>&1)" && fail "4: duplicate seat id parsed"
echo "$OUT4" | grep -q "Duplicate role 'coder@fable'" || fail "4: duplicate not named: $OUT4"
pass "4: duplicate seat id refused naming the collision"

# ── 5: shared worktree still refused ──────────────────────────────────────
ROOT5="$(mk_root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
window coder claude coder --model x
window coder@fable claude coder --model x
CONF
OUT5="$(run_parse "$ROOT5" 2>&1)" && fail "5: shared worktree parsed"
echo "$OUT5" | grep -q "Duplicate worktree 'coder'" || fail "5: worktree collision not named: $OUT5"
pass "5: shared worktree refused naming the collision"

# ── 6: an @-seat without its stage's bare seat is refused; malformed seat
#      ids and coordinator seats are refused ──────────────────────────────
ROOT6="$(mk_root)"
cat > "$ROOT6/swarmforge/swarmforge.conf" <<'CONF'
window specifier claude master --model x
window coder@fable claude coder-fable --model x
CONF
OUT6="$(run_parse "$ROOT6" 2>&1)" && fail "6: bare-seat-less stage parsed"
echo "$OUT6" | grep -q "no bare 'coder' seat" || fail "6: missing-bare-seat not named: $OUT6"
for bad in 'coder@' '@fable' 'coder@a@b'; do
  ROOTB="$(mk_root)"
  printf 'window %s claude wt-x --model x\n' "$bad" > "$ROOTB/swarmforge/swarmforge.conf"
  OUTB="$(run_parse "$ROOTB" 2>&1)" && fail "6: malformed seat id '$bad' parsed"
  echo "$OUTB" | grep -q "Invalid seat id" || fail "6: malformed '$bad' not named: $OUTB"
done
ROOTC="$(mk_root)"
printf 'window coordinator@extra claude wt-c --model x\n' > "$ROOTC/swarmforge/swarmforge.conf"
OUTC="$(run_parse "$ROOTC" 2>&1)" && fail "6: coordinator seat parsed"
echo "$OUTC" | grep -q "coordinator is reserved" || fail "6: coordinator seat not refused: $OUTC"
pass "6: bare-seat requirement, malformed seat ids and coordinator seats all refused"

# ── 7: a single-seat pack's roles.tsv is byte-identical to the pre-change
#      script's output (BL-982 invariant 2 anchor) ────────────────────────
# The pre-change script, pinned by BLOB sha (the exact swarmforge.sh this
# parcel's merge-base carried - durable, unlike HEAD~N which drifts as the
# branch grows). It sources SCRIPT_DIR-relative helpers, so it runs from a
# temp dir populated with symlinks to the real scripts dir, its own
# swarmforge.sh entry replaced by the extracted blob.
PRE_BLOB="2edd9a17ba9d40709c0f436d12395b638563c0ca"
PRE_DIR="$(mktemp -d)"; register_tmp_dir "$PRE_DIR"
for entry in "$SCRIPT_DIR/.."/*; do
  ln -s "$entry" "$PRE_DIR/$(basename "$entry")"
done
rm "$PRE_DIR/swarmforge.sh"
git -C "$SCRIPT_DIR/../../.." cat-file blob "$PRE_BLOB" > "$PRE_DIR/swarmforge.sh"
PRE_SH="$PRE_DIR/swarmforge.sh"
ROOT7A="$(mk_root)"; ROOT7B="$(mk_root)"
for r in "$ROOT7A" "$ROOT7B"; do
  cat > "$r/swarmforge/swarmforge.conf" <<'CONF'
window specifier claude master --model claude-opus-5 --effort xhigh
window coder claude coder --model claude-sonnet-5 --effort xhigh
CONF
done
run_parse "$ROOT7A" || fail "7: current script failed on single-seat conf"
env -u SWARMFORGE_CONFIG XDG_RUNTIME_DIR=/tmp zsh -c "source '$PRE_SH' '$ROOT7B'; parse_config; write_roles_file" || fail "7: pre-change script failed"
# Normalize the absolute-root difference before diffing.
sed "s|$ROOT7A|ROOT|g" "$ROOT7A/.swarmforge/roles.tsv" > "$ROOT7A/norm.tsv"
sed "s|$ROOT7B|ROOT|g" "$ROOT7B/.swarmforge/roles.tsv" > "$ROOT7B/norm.tsv"
diff "$ROOT7A/norm.tsv" "$ROOT7B/norm.tsv" || fail "7: single-seat roles.tsv changed shape vs pre-change script"
pass "7: single-seat pack provisions byte-identically to the pre-change script"

echo "ALL PASS"
