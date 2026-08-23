# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — documenter pass — 20260823

Commit reviewed: `ae1f495966` (hardener's forward, `merge_and_process hardender
ae1f495966`).

## What changed

Reviewed the full BL-1081 slice (coder + architect re-fix + hardener mutation
kill, since this is the first documenter pass on this ticket): a thin ACP
host module (`extension/src/swarm/acpHostRuntime.ts`,
`acpSeatState.ts`, `acpSessionEvents.ts`) that folds Agent Client Protocol
events into a per-seat snapshot (`.swarmforge/acp/<role>.json`); a bb reader
(`swarmforge/scripts/acp_session_lib.bb`) wired into the babysitter's live
per-role decision site (`gather-role` in `babysitter_check.bb`); two
`babysitterd_sweep_lib.bb` checks that change for an ACP-hosted seat
(`check-busy-frozen` skipped, new `check-acp-seat` CRIT on a structured
permission block, distinct from the interactive-menu CRIT); and a new `:acp`
dimension on `prompt_engine_lib.bb`'s provider-capabilities table
(`copilot`, `vibe`, `gemini` marked native; `acp-native?` added). No
production code spawns the host yet — grepped for `AcpHostSession` /
`acpHostRuntime` / `acp_session_lib` outside tests and the module itself;
only the two consumers above exist. This is a spike, still building toward
its falsifiable E2E criteria (`qa_e2e_procedure` on the ticket), not a
completed feature.

## Doc surfaces checked

- No existing doc anywhere in `docs/` mentioned ACP, `acp_session_lib`, or
  the provider-table `:acp` dimension (grepped `docs/`) — this is genuinely
  new ground, not a stale reference to fix.
- Wrote a new reference doc,
  `docs/reference/BL-1081-acp-hosted-seat-snapshot.md`, modelled on
  `BL-643-non-pipeline-agents-reference-table.md`'s style: the snapshot file
  schema (every field, with meaning), the provider-table dimension and its
  absent-reads-as-false rule, which babysitter checks change and why the two
  CRITs stay distinct, and an explicit "what is not wired yet" section so a
  reader does not conclude a real seat is being ACP-driven in production
  today. Linked from `docs/index.md`'s Reference section in the same commit.
- `docs/reference/Specification.MD` — grepped for "ACP" / "Agent Client
  Protocol": no mention. This is an M8 internal-machinery spike, not part of
  the product-level spec surface the Specification tracks (the file's scope
  is the extension's own commands/UI/PR flow); no content change, so its
  "Last Updated" field is left untouched per the constitution's rule against
  bumping a freshness date without a content change.
- `docs/diagrams/architecture.mmd` and `swarm-flow.mmd` — grepped for
  `babysitter`, `acp`, `.swarmforge/acp`. `architecture.mmd` has no
  babysitterd node at all (confirmed against the BL-1071 documenter pass,
  which found and recorded the same gap as out of that diagram's scope —
  the diagram is scoped to extension host/webview(s)/tmux substrate/
  `.swarmforge` state at the PANEL/BRIDGE/PANES granularity, not individual
  daemon-internal checks). Since no production code spawns the ACP host
  (see above), there is also no new component or channel actually running
  yet for the diagram to depict — this stays a follow-up for whichever
  parcel wires the launcher, same as babysitterd itself was never
  diagrammed. No diagram change made.
- README.md: no user-facing command, setting, or flow was added by this
  ticket (the spike is entirely internal machinery); no README change
  needed.

## Forward

Forwarding the received commit unchanged to QA, priority 00.

By documenter.
