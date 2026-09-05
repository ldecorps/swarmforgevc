# The Art Director seat (BL-1417/BL-1418)

Article 1.10 introduces the Art Director: the role that reviews the look
and feel of every human-facing artifact the swarm produces (briefing
emails, Telegram messages, the PWA, console screens, rendered docs) on
its real surface. Article 1.10's prose alone is not a seat — `swarm_handoff.sh`
refuses a recipient not in `.swarmforge/roles.tsv`, `ensureRoleTopics`
creates no Telegram topic for a role the icon map doesn't know, the model
factory can't assign it a model, and `prepare_worktrees` creates no
worktree for a role the pack doesn't declare. BL-1418 makes the seat real
everywhere a role must exist.

## Seat shape (human ruling, 2026-09-05)

**Standing pane** — an always-on tmux window like every pipeline role,
its own Telegram topic in the sidebar, reviewing on wake. Two other
shapes were posed and not chosen: an on-demand seat (no pane until the
coordinator rotates it in, the Model Steward's shape) and a presentation
stage (editing templates/CSS itself, sitting before QA on artifact
parcels — out of scope here, a follow-up ticket if ever chosen). A fourth
option (folding the role into the documenter, no new seat) was closed the
same ruling: the Art Director stays a seat of its own.

**The Art Director is outside the forward chain**, the same way the
coordinator is (Article 1.10) — it never receives a `git_handoff` parcel
and is never a pipeline stage a ticket is handed to.

## Where the seat lives

- **Pack window**: `swarmforge/packs/full-forge.conf` —
  `window art-director claude art-director --model claude-sonnet-5
  --dangerously-skip-permissions --effort medium --remote-control
  SwarmForge-ArtDirector` (task receive mode, forward-only).
- **Worktree**: `.worktrees/art-director` on branch `primary/art-director`
  — created by `prepare_worktrees` (`swarmforge.sh`) like every other
  role's worktree, never hand-created.
- **Mailbox**: the standard per-role mailbox under
  `.worktrees/art-director/.swarmforge/handoffs/` — a `type: note` sent
  to `art-director` via `swarm_handoff.sh` is delivered there like any
  other role's mail.
- **Telegram topic**: its own icon, `🔮`, distinct from every other
  role's icon (`topicIcon.ts`'s `ROLE_TOPIC_ICON` map) — created by
  `ensureRoleTopics` the first time the seat needs one, recorded in
  `.swarmforge/operator/role-topic-map.json`.
- **Model assignment**: `bb swarmforge/scripts/model_factory_cli.bb assign
  --mode quality` lists `art-director` alongside every other seat.

`.swarmforge/roles.tsv` is derived from the pack at `./swarm` start —
never hand-written.

## Every role enumeration was audited, not guessed

The ticket's own invariant: every enumeration of swarm roles in the
codebase either names `art-director` (a SWARM-ROLES list — the whole
roster) or is explicitly a pipeline-chain list and stays untouched (the
Art Director is not a stage a parcel is ever handed to). Both classes are
now pinned by a standing unit test
(`extension/test/bl1418RoleEnumerationClassification.test.js`), so the
next role added does not repeat the grep-and-classify hunt by hand:

| List | Class | Gains `art-director`? |
|---|---|---|
| `roleTopicMapStore.ALL_SWARM_ROLES` | swarm-roles | Yes |
| `topicIcon.ts`'s `RoleTopicIconRole` type + `ROLE_TOPIC_ICON` map | swarm-roles | Yes |
| `model_factory_lib.bb`'s `swarm-roles` | swarm-roles | Yes |
| `rolePack.ts`'s `PIPELINE_CHAIN` | chain | No — not a stage |
| `swarmMetrics.ts`'s `PIPELINE_ORDER` | chain | No |
| `qaBounce.ts`'s `KNOWN_PRODUCING_ROLES` | chain | No |
| `pipelineReviewOracle.ts`'s `REVIEW_STAGES` | chain | No |
| `required_stages_lib.bb`, `routing_manifest_lib.bb` | chain | No |

## Verify the seat is real

```bash
grep art-director .swarmforge/roles.tsv                  # after ./swarm
tmux ls                                                   # swarmforge-art-director pane exists
ls .worktrees/art-director                                # worktree exists, branch primary/art-director
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality  # lists art-director
```

From any pane: send a note to confirm delivery —

```bash
cat > tmp/handoff.txt <<'EOF'
type: note
to: art-director
priority: 50
message: hello
EOF
swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt
```

The file appears under the art director's own `inbox/new/`; its
`ready_for_next.sh` returns it.

## What this ticket does not build

- The role's own first deliverables (`docs/design/artifact-inventory.md`,
  `docs/design/system.md`) — the seat's own work, not this parcel's.
- Any presentation-stage chain wiring (`required_stages`, the routing
  manifest, `PIPELINE_CHAIN`, an Article 4.3 stage row) — only relevant if
  a future ruling changes the seat shape.

Acceptance: `specs/features/BL-1418-the-art-director-seat-is-addressable.feature`.

Related: [Article 1.10](../../swarmforge/constitution/articles/01_roles.md),
the constitution's own definition; BL-1419 — the Art Director's first job
(reviewing the briefing email's reflow), minted ahead of the seat existing.
