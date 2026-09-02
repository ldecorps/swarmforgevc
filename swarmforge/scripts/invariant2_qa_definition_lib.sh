#!/usr/bin/env bash
# BL-925 invariant 2, as a predicate: there is ONE definition of "QA-approved
# tip" in the repo. A second predicate that answers the same question
# differently is the defect, not the fix.
#
# Both check_pipeline_code_on_main.sh (bash) and handoffd.bb (Babashka) must
# reach that question by calling is_qa_ancestor.sh, and neither may ALSO run
# its own inline `merge-base --is-ancestor ... swarmforge-QA` - a "kept in
# sync" pair of independent invocations is exactly what the invariant forbids,
# even with the shared script still present and called.
#
# BL-1314 extracted this out of test_pipeline_code_on_main_guard.sh, where it
# was inline and could therefore only ever be run against the live tree. The
# checks themselves are unchanged except for the scoping fix below.
#
# THE SCOPING FIX (BL-1314). The Babashka half used to grep handoffd.bb for
# `"merge-base".*"--is-ancestor"` - ANY ancestry call, whatever pair of refs it
# was about. That was equivalent when BL-925 wrote it on 2026-08-18, because
# the QA call was then the only ancestry call in the file. It stopped being
# equivalent on 2026-08-25, when BL-1130 added an origin/main-versus-HEAD check
# and BL-668 a generic fast-forward helper - neither of which asks "is this a
# QA-approved tip". Both halves are now scoped to the question, by the
# `swarmforge-QA` ref name, which is the only durable anchor for "this call
# asks the QA question".
#
# KNOWN LIMIT, stated rather than engineered around: a re-inlined call that
# binds the ref to a variable (`(def qa-ref "swarmforge-QA")` and then
# `["git" "merge-base" "--is-ancestor" sha qa-ref]`) escapes this pin - and
# escapes its bash sibling equally. That is inherent to a grep-based pin. It is
# deliberately NOT closed by enumerating the file's legitimate ancestry calls
# in an allowlist: a hand-enumerated membership list rots silently (BL-973,
# four dead fixtures) and would fail again the next time a helper is added for
# a fourth unrelated question.

# Prints one violation message per line and returns 1 when any is found;
# prints nothing and returns 0 when clean. Reports EVERY violation in one
# pass - a caller that stopped at the first would hide the rest, which is
# Article 4.4's complete-inventory rule in the shape of a gate.
inv2_qa_definition_violations() {
  local guard="$1" handoffd="$2"
  local -a violations=()

  if [[ ! -f "$guard" ]]; then
    echo "BL-925 invariant 2: guard file not found: $guard"
    return 1
  fi
  if [[ ! -f "$handoffd" ]]; then
    echo "BL-925 invariant 2: handoffd file not found: $handoffd"
    return 1
  fi

  # The shared definition must still be reached from both files.
  grep -q "is_qa_ancestor.sh" "$guard" \
    || violations+=("BL-925 invariant 2: check_pipeline_code_on_main.sh no longer calls is_qa_ancestor.sh")
  grep -q "is_qa_ancestor.sh" "$handoffd" \
    || violations+=("BL-925 invariant 2: handoffd.bb no longer calls is_qa_ancestor.sh")

  # ...and neither may answer the SAME question a second time, inline.
  grep -q 'merge-base.*--is-ancestor.*swarmforge-QA' "$guard" \
    && violations+=("BL-925 invariant 2: check_pipeline_code_on_main.sh still runs its own inline ancestry git call against swarmforge-QA")
  grep -q '"merge-base".*"--is-ancestor".*swarmforge-QA' "$handoffd" \
    && violations+=("BL-925 invariant 2: handoffd.bb still runs its own inline ancestry git call against swarmforge-QA")

  # BL-801: stock macOS bash 3.2 treats an empty array as unbound under `set -u`.
  if (( ${#violations[@]} == 0 )); then
    return 0
  fi
  printf '%s\n' ${violations[@]+"${violations[@]}"}
  return 1
}
