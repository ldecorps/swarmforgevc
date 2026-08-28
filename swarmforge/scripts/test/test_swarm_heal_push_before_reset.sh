#!/usr/bin/env bash
# BL-1198: swarm_heal.bb's heal! is one of the three real call sites wired
# to rematch-with-push-first! (master_main_reconcile_lib.bb) — its own
# git-push/git-reset adapters (both trivial one-liners) had ZERO test
# coverage of any kind before this file: master_main_reconcile_lib_test_
# runner.bb / _property_runner.bb only exercise the SHARED pure primitive
# against FAKE adapters, and no prior test file existed for swarm_heal.bb
# at all (grepped: nothing under swarmforge/scripts/test/ referenced it by
# name). This is the required_wiring class of gap — "the architect
# confirmed it by reading the source" is not the same as "a real test
# proves it reachable" (same lesson as this session's own BL-592 hardening
# pass, generalized from bridgeServer.ts routes to a babashka CLI's real
# git adapters).
#
# WHY THERE IS NO "push saves an ahead-only commit" SCENARIO HERE (traced,
# not assumed — read this before adding one): every path into `:rematch!`
# (post-land-absorb-plan / automated-absorb-plan in
# master_main_reconcile_lib.bb) is gated `(zero? (or behind 0)) → :noop`
# FIRST. Reaching `:rematch!` at all therefore requires `behind > 0` —
# a GENUINE two-way divergence at the moment of the decision. Within one
# synchronous `heal!` invocation, the push attempt happens milliseconds
# after that same decision, against the same unmoved origin — so it is
# structurally rejected too (git refuses a non-fast-forward push exactly
# as it refuses `--ff-only`). Confirmed empirically below (§1): a plain
# ahead-only/behind=0 local commit never reaches `:rematch!` at all — it
# resolves via the untouched `:noop` path instead, so it doesn't exercise
# BL-1198's new code and isn't a meaningful demonstration of the fix.
# rematch-with-push-first!'s actual protective case (a decision that has
# gone stale relative to a concurrent push landing on origin between the
# decision and the reset) requires a second concurrent actor racing the
# exact same checkout mid-call — outside what one process's real-git CLI
# invocation can honestly reproduce; master_main_reconcile_lib_property_
# runner.bb's `bl1198` property (fake adapters, 500 generated runs, with
# its own non-vacuity check) is the correct level for that logic and
# already covers it exhaustively.
#
# What THIS file adds instead: proof that swarm_heal.bb's real adapters
# are correctly wired to the primitive end-to-end (previously untested at
# any level), and the ticket's own explicit regression guard — a genuine
# divergence must still resolve exactly as it did before this ticket, via
# the unchanged reset recovery, once the (now-mandatory) push attempt is
# rejected. test_handoffd_master_main_reconcile_wiring.sh already proves
# this same guard for handoffd.bb's own call site (its "scenario 02");
# this file is the swarm_heal.bb sibling. post_hotfix_merge_origin.bb's
# real adapters remain untested by any file (out of scope for this pass —
# flagged separately, see hardener evidence).
#
# HONEST LIMIT, CONFIRMED BY HAND-MUTATION (do not read this file's own
# green run as proof the fix works): reverting swarm_heal.bb's :rematch!
# back to a bare `git reset --hard origin/main` (BL-1198's pre-fix shape)
# and re-running this exact file produces byte-identical PASS output on
# both scenarios below. This file has ZERO discriminating power for
# BL-1198's actual behavior change - a direct consequence of the
# reachability constraint traced above (every scenario this CLI can
# honestly reach via real git already has push failing structurally,
# whether or not push is attempted first). It is a real, valuable wiring/
# regression guard - it is not, and cannot be, an existence proof of the
# fix. That proof is master_main_reconcile_lib_property_runner.bb's
# `bl1198` property + its explicit non-vacuity check, which DOES catch
# this exact mutant (confirmed: reverting the shared rematch-with-push-
# first! primitive itself, as opposed to one call site's wiring, fails
# that property immediately).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HEAL="$SCRIPT_DIR/../swarm_heal.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

REMOTE="$(cd "$(mktemp -d)" && pwd -P)"
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
CLONE2="$(cd "$(mktemp -d)" && pwd -P)"
cleanup() { rm -rf "$REMOTE" "$ROOT" "$CLONE2"; }
trap cleanup EXIT

# ── a real bare remote ──────────────────────────────────────────────────
git init --quiet --bare "$REMOTE"
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main

git init --quiet "$ROOT"
git -C "$ROOT" config user.email "test@example.com"
git -C "$ROOT" config user.name "Test"
git -C "$ROOT" checkout -q -b main
echo "seed" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "seed commit"
# heal! writes its own runtime state under .swarmforge/daemon/ (deadlock +
# reconcile-state JSON) on every run - gitignore it exactly like the real
# repo's own .gitignore does, or the SECOND scenario's dirty-tree check
# blocks on the first scenario's own leftover state (same technique as
# test_handoffd_master_main_reconcile_wiring.sh's fixture scaffold).
cat > "$ROOT/.gitignore" <<'GITIGNORE'
.swarmforge/
GITIGNORE
git -C "$ROOT" add .gitignore
git -C "$ROOT" commit -q -m "fixture scaffold"
git -C "$ROOT" remote add origin "$REMOTE"
git -C "$ROOT" push -q origin main

mkdir -p "$ROOT/.swarmforge/daemon"

# ═══════════════════════════════════════════════════════════════════════
# §1 — boundary check: a plain ahead-only (behind=0) local commit never
# reaches :rematch! at all (see the header comment's trace). heal! must
# leave it exactly where it is — untouched, unpushed, waiting for the
# ordinary periodic push-sweep — never resetting a state that was never
# in danger. Proves BL-1198's changes did not regress this simple, far
# more common case into taking the rematch path unnecessarily.
# ═══════════════════════════════════════════════════════════════════════

echo "local-only bookkeeping" > "$ROOT/local-only.txt"
git -C "$ROOT" add local-only.txt
git -C "$ROOT" commit -q -m "local-only bookkeeping commit"
LOCAL_SHA="$(git -C "$ROOT" rev-parse HEAD)"

set +e
HEAL_OUT="$(bb "$SWARM_HEAL" "$ROOT" 2>&1)"
set -e

if ! git -C "$ROOT" merge-base --is-ancestor "$LOCAL_SHA" main 2>/dev/null; then
  echo "$HEAL_OUT" >&2
  fail "§1: the ahead-only local commit $LOCAL_SHA is no longer reachable from main - something reset it despite no real divergence (behind=0)"
fi
pass "§1: an ahead-only, non-diverged commit is left untouched by heal! (:noop, never :rematch!)"

if git -C "$REMOTE" cat-file -e "$LOCAL_SHA" 2>/dev/null; then
  echo "$HEAL_OUT" >&2
  fail "§1: the ahead-only commit reached origin - heal!'s :noop path pushed on its own, which is new, unreviewed behavior outside :rematch!'s push-first fix"
fi
pass "§1: the commit stays local and unpushed (the ordinary push-sweep's job, not heal!'s :noop path)"

# ═══════════════════════════════════════════════════════════════════════
# §2 — the ticket's own regression guard: a GENUINE two-way divergence.
# Reaching :rematch! now means a push was attempted and (correctly, and
# unavoidably for a real fork - see header) rejected; the existing
# reset-to-origin recovery must still fire exactly as it did before this
# ticket, discarding the local-only commit that has no home on origin.
# ═══════════════════════════════════════════════════════════════════════

# A second clone lands an independent commit directly on origin, so the
# next local commit in $ROOT genuinely diverges (neither side is a plain
# ancestor of the other) rather than merely racing an unpushed tip.
git clone --quiet "$REMOTE" "$CLONE2"
git -C "$CLONE2" config user.email "test@example.com"
git -C "$CLONE2" config user.name "Test"
echo "origin-side change" > "$CLONE2/origin-only.txt"
git -C "$CLONE2" add origin-only.txt
git -C "$CLONE2" commit -q -m "origin-side commit (unrelated file)"
git -C "$CLONE2" push -q origin main
ORIGIN_SHA="$(git -C "$CLONE2" rev-parse HEAD)"

echo "another local-only commit" > "$ROOT/local-only-2.txt"
git -C "$ROOT" add local-only-2.txt
git -C "$ROOT" commit -q -m "local-only commit 2 (this must be discarded — genuine divergence)"
DISCARDABLE_SHA="$(git -C "$ROOT" rev-parse HEAD)"

set +e
HEAL_OUT2="$(bb "$SWARM_HEAL" "$ROOT" 2>&1)"
set -e

CURRENT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
if [[ "$CURRENT_SHA" != "$ORIGIN_SHA" ]]; then
  echo "$HEAL_OUT2" >&2
  fail "§2: expected local main to land exactly on origin's tip ($ORIGIN_SHA) after a rejected push + reset; got $CURRENT_SHA"
fi
pass "§2: after a genuinely rejected push, the existing reset-to-origin recovery still lands local main on origin's real tip"

if git -C "$ROOT" merge-base --is-ancestor "$DISCARDABLE_SHA" main 2>/dev/null; then
  fail "§2: the local-only commit from the genuinely diverging branch is STILL reachable from main - the reset never actually discarded it"
fi
pass "§2: the genuinely-diverging local-only commit is discarded by the reset, as designed (regression guard: push-first does not weaken real-divergence recovery)"

echo "ALL PASS"
