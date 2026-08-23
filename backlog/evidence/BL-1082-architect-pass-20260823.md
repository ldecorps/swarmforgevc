# BL-1082 architect pass — 2026-08-23

Commit reviewed: `1d34d7ab6f` (cleaner tip —
`BL-1082: encode invariant 2 over inside vs outside store placement`).
Merged into architect for review; this evidence commit is the forward tip
(BL-536).

Prior bounce cleared:
`backlog/evidence/BL-1082-architect-bounce-20260823.md` (D1 vacuous
invariant-2 encoding).

## Review inventory (Article 4.4)

### Gates run

- Dependency gate (`extension/` cwd,
  `node out/tools/dependency-gate.js` on
  `src/swarm/modelServing.ts` + `src/tools/named-model*.ts`):
  **PASSED** — no forbidden edges.
- Co-change report: expected coupling to BL-1082 unit/property/step files
  and the named-model CLI split. Historical co-change with pack/profile
  paths and BL-1081 surfaces is from earlier entanglement commits;
  **informative only**, no new boundary bounce.
- Architecture boundaries (tiles/webview vs tmux substrate; host I/O at
  CLI edge via `execSync` in `named-model.ts`; pure plan composition in
  `modelServing.ts`; secrets not written to worktree): **PASSED**.
- Declared invariants 1–3: property encodings present in
  `extension/test/bl1082NamedModelServingInvariants.property.test.js`.
  - Inv1 / inv3: unchanged encodings; green.
  - Inv2: rewritten to quantify over inside vs outside store placement;
    shared `assertPullWritesCannotReachCommit` used by the property and
    the non-vacuity check; broken planner that ignores `repoRoot` turns
    the shared assertion red. **Vacuous D1 cleared.**
- Property lane: 6/6 green.
- Unit: `modelServing.test.js` + `namedModelCli.test.js` 30/30 green.
- Undeclared property pass (BL-654): no additional undeclared property
  warranted beyond the three declared encodings on this pure planner.

### Defects

NONE.
