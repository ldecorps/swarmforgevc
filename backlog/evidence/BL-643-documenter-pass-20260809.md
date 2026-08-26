# BL-643 — documenter pass evidence (2026-08-09)

## Inventory: NONE

Full documenter checklist run against the coder's commit (`91f48929ea`,
which itself already carries the two documents and their step-handler
verifier — see the ticket's `notes:` on why coder lands documenter-shaped
deliverables here). No defect found; nothing to bounce.

- **Divio mode placement** — `docs/reference/BL-643-non-pipeline-agents-reference-table.md`
  is pure reference (a checked table, no narrative); `docs/explanation/BL-643-non-pipeline-agents-as-a-class.md`
  is pure explanation (taxonomy, understanding-oriented). Neither blends modes. PASS.
- **`docs/index.md` links (scenario 08)** — both documents are linked, each
  under its correct section header (`## Reference` line 87, `## Explanation`
  line 98), added in the same commit as the documents (`e1c39eef`). PASS.
- **Prose currency / consistency with the code today** — spot-checked every
  path cited in the reference table (20 launcher/stop/prompt/log paths) against
  this worktree's tree: all resolve. Spot-checked the explanation doc's factual
  claims: `swarmforge/roles/onboarder.prompt` confirmed absent;
  `extension/src/onboarding/onboarderState.ts` exports `isBareDoneClaim`;
  `onboarderStateStore.ts` exports `slugifyTargetRepoUrl`; `launch_onboarder.sh`
  invokes `onboarder_supervisor.bb` / `onboarder-reconcile.js`;
  `ensureOnboardingTopic` confirmed in `extension/src/tools/telegram-front-desk-bot.ts`;
  BL-590 confirmed in `backlog/done/`; BL-624/BL-625 confirmed still in
  `backlog/paused/`; `swarmforge/roles/front_desk.prompt` confirmed absent,
  `support.prompt` confirmed to self-describe as "front desk". All claims held. PASS.
- **Acceptance run** — `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-643-non-pipeline-agents-documented-as-a-class.feature`:
  17/17 sub-scenarios green (8 scenarios, outlines expand to 6+3+3 rows per
  the ticket's own QA procedure step 1). Required a local `npm run compile`
  first (`extension/out/` is gitignored, per the Guardrails rule) — no code
  change, tree was just stale in this worktree.
- **Coder's placement/framing judged correct as-is** — per the ticket's own
  notes ("If the documenter judges the coder's placement or framing wrong,
  that is a normal documenter edit, not a bounce"): no edit needed, framing
  and scope (slice-1-only Onboarder coverage, Expeditor linked not restated,
  all irregular cases explained) match the ticket's acceptance criteria.

No blocked checks. Forwarding to QA.

By documenter.
