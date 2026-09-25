# Starter kit

Generic files a greenfield target receives when it is onboarded (BL-1758,
the human's ruling A of 2026-09-25): the starter kit installs from this
local checkout. The installer copies this checkout's live engine, hooks,
handoff protocol, generic constitution and the mono-router pack at install
time. Only the files that must differ from swarmforgevc's own live here.

- `roles/` - one short, project-agnostic prompt per role the mono-router
  pack runs, plus the coordinator. swarmforgevc's own
  `swarmforge/roles/*.prompt` describe this project (TypeScript, vitest,
  the VS Code extension) and are never copied into a target.

Provenance: the eight role prompts were written by hand by the operator
while onboarding gpu-bargain-hunter on 2026-09-25. That swarm launched and
minted tickets on them. The specifier landed them here as BL-1758's prose
deliverable (BL-798), removing one reference to that project's own ticket.
The specifier owns these files, as it owns every prompt file.
