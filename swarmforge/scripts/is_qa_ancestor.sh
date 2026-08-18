#!/usr/bin/env bash
# BL-925 invariant 2: the ONE definition of "is <sha> a QA-approved tip" -
# shared by check_pipeline_code_on_main.sh (bash, direct call) and
# handoffd.bb (Babashka, via process/sh) so a future rename of the
# swarmforge-QA ref, or a change to the ancestry predicate, has exactly one
# call site to update instead of two independently-maintained git
# invocations. A "kept in sync" comment across that language boundary is not
# a gate (engineering article's constant-across-a-language-boundary rule);
# this extraction is the gate.
#
# Exit code is git merge-base --is-ancestor's own, passed straight through:
#   0 = is an ancestor of swarmforge-QA (QA-approved)
#   1 = a clean "no" (not approved - never an error)
#   anything else = a real git failure (e.g. an unresolvable sha or a
#     missing swarmforge-QA ref) - callers must fail closed on that case
#     rather than reading it as "not approved".
#
# Operates on the CALLER's current working directory, never this script's
# own location: check_pipeline_code_on_main.sh already `cd`s to its target
# repo before calling this, and handoffd.bb spawns it with :dir set to
# project-root - both must check ancestry in that repo, not in wherever this
# script happens to live (which is this swarm's own checkout, not
# necessarily the project-root being swept).
#
# Usage: is_qa_ancestor.sh <sha>
set -euo pipefail

SHA="${1:?Usage: is_qa_ancestor.sh <sha>}"

exec git merge-base --is-ancestor "$SHA" swarmforge-QA
