Feature: A mono-role rotating pack carries each parcel through the whole pipeline with one resident agent, dropping no gate

# BL-448 (feature, Operator directive 2026-07-16 + human decisions same day). A new pack `mono-rotate`:
# ONE resident pipeline agent plays every role in turn - assume a role, do the work + its gate, self-hand
# the parcel off, re-prompt into the next role, and so on down the chain coder->cleaner->architect->
# hardener->documenter->QA - instead of one long-lived agent per role. The coordinator stays separately
# auto-provisioned (reserved infrastructure, BL-243). Driver: the FES box (15GB) OOM-crashed and holds only
# ONE full swarm (BL-435/BL-439); one resident pipeline process instead of two-plus fits a
# memory-constrained host. Defined as a GENERAL pack, and (human decision 2026-07-16) adopted as FES's
# DEFAULT bring-up, superseding BL-439's 2-pack.
#
# HUMAN DECISIONS 2026-07-16 (answers to the specifier's backlog-root drain questions):
#   - GATE MODEL: FULL pipeline, ALL gates preserved. Every gate the full pack runs - acceptance,
#     coverage, mutation/no-survivors, CRAP<=6, QA final - still runs. Slower wall-clock is the accepted
#     cost, never a lighter gate.
#   - FES RELATIONSHIP: mono-rotate BECOMES FES's default (BL-439 reshaped to point at it; depends_on).
#   - ROTATION MECHANISM: the architect's call between a single re-prompted process vs. role windows
#     sequenced one-at-a-time vs. other. BUILD-TIME DECISION MADE (coder pass, see below): role windows
#     sequenced one-at-a-time, self-rotated - see swarmforge/packs/mono-rotate.conf/.prompt and
#     swarmforge.sh's `config rotation sequential` / is_sequential_dormant.
#
# WHAT SHIPPED THIS PASS (mechanism-agnostic infrastructure + a documented first-cut mechanism):
#   - swarmforge/packs/mono-rotate.conf: a `config rotation sequential` pack declaring coder, cleaner,
#     architect, hardender, documenter, QA - each still gets its own worktree + roles.tsv entry (mailbox
#     resolution is SWARMFORGE_ROLE + roles.tsv driven, never tied to which physical pane asks), but only
#     the FIRST window line gets a real tmux session/process.
#   - swarmforge.sh: `config rotation sequential` parsing + is_sequential_dormant, gating the session-
#     creation/launch/window-open loops so every OTHER pipeline role's window is provisioned (worktree,
#     roles.tsv) without its own process. The coordinator is never dormant - it is provisioned exactly as
#     in every other pack (BL-243).
#   - swarmforge/packs/mono-rotate.prompt: the resident agent's own self-rotation protocol (export
#     SWARMFORGE_ROLE, cd into the next role's worktree, re-read that role's own prompt, continue its loop)
#     - reusing the SAME `SWARMFORGE_ROLE` + `roles.tsv` mailbox resolution every dedicated-process pack
#       already relies on (handoff_lib.bb's my-mailbox-base-dir), so no daemon/mailbox change was needed.
#
# INDEPENDENCE CAVEAT (the ticket's own central design risk - NOT papered over). A "bounce" under
# mono-rotate is a self-review: the same resident agent plays both sides of every gate. This pass does
# NOT ship an automated context-reset-and-rebootstrap watcher (detecting "role R just handed off, clear
# and re-bootstrap this pane as role R+1" is a genuinely new piece of runtime automation, and deciding
# whether/how to build it is itself part of "how a self-bounce is made meaningful" - the architect's own
# call per this ticket's spec). Until such a watcher exists, mono-rotate.prompt instructs the resident
# agent to treat each role-switch as a genuinely fresh, skeptical read of the new role's own prompt and the
# ticket - not a carried-over assumption - as the manual stand-in for a hard context reset. Flagged
# explicitly for architect review, not silently assumed sufficient.
#
# EXECUTABLE-vs-LIVE split (settled at build time, as BL-439's own precedent): this feature has ONE
# executable scenario below (pack composition against the parse_config/is_sequential_dormant seam, via
# swarmforge/scripts/test/test_rotation_sequential_pack.sh - no real tmux session, per that test's own
# header). The ticket's other two acceptance.steps entries - "a parcel is carried through every pipeline
# role in order before it is done" and "every quality gate the full pack enforces still runs" - are LIVE QA
# PROCEDURES (see the ticket's own E2E QA PROCEDURE field): they require a real mono-rotate swarm actually
# rotating a real parcel through real gates, which is exactly the piece this pass's manual (not automated)
# rotation protocol cannot yet exercise unattended. Materialized (not left a .draft, BL-441) with real
# scope honesty rather than fake step handlers that would always pass without checking anything.

Background:
  Given the swarm is launched against a target with the mono-rotate pack

# BL-448 mono-rotate-01
Scenario: one resident pipeline agent serves every role, not one process per role
  When the swarm is up
  Then a single resident pipeline agent covers all pipeline roles
  And the coordinator is provisioned separately as reserved infrastructure
