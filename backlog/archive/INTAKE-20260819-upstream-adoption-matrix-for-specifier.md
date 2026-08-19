# Raw intake — Upstream branch scan (2026-08-19): adoption matrix for specifier challenge

Status: new intake. Purpose: convert today's upstream drift scan into a specifier-facing intake with explicit recommendations **and** explicit "argue against this" prompts.

Scope of scan (today):
- `unclebob/swarm-forge` new branches vs tracked `ub/main`: `two-pack`, `four-pack`, `six-pack`, `squad`
- `unclebob/Acceptance-Pipeline-Specification` new branch vs tracked `aps/main`: `codex/bb-tools-equivalence`
- Upstream tracked `main` baselines themselves did not advance; deltas are on these new branches.

## Executive recommendation

1. **Prioritize APS `codex/bb-tools-equivalence` first** (smallest blast radius, concrete tooling wins, likely fast payoff).
2. **Treat `squad` as a strategic program, not a quick adopt** (large capability gain, but very high integration and governance cost).
3. **Treat `two/four/six-pack` as prompt-operating-model references**; cherry-pick principles, avoid direct model replacement.

## Adoption matrix (for specifier)

### A) APS `codex/bb-tools-equivalence` — **ADOPT (targeted slices)**

Observed headline commits:
- `1dd6bc09a` Add babashka acceptance tools
- `55dc7e0aa` Add help output to Babashka tools
- `1847a252e` remove go tools
- `3a1d7b063` Add default parameter inference to the Gherkin parser
- `1001283af` Move gherkin mutation metadata to work dir

Why likely worth getting:
- Consolidates APS toolchain around Babashka with stronger test coverage and lower split-brain maintenance between Go and BB.
- Parser inference and mutation metadata pathing are practical correctness/ergonomics wins, not only stylistic rewrites.
- Adoption can be sliced by command/tool behavior and validated with existing APS contracts.

Specifier challenge prompts:
- Which of these commits are behavior changes vs pure porting?
- For behavior changes, which existing local tests fail to protect us?
- Can we isolate parser inference as one parcel and metadata relocation as another?
- Do we need compatibility shims for any local scripts still invoking old tool entry points?

### B) `swarm-forge` `squad` — **MAYBE (program-level evaluation, not immediate adopt)**

Observed headline themes:
- New control plane and daemonized orchestration (`squadd`, `squad_*` toolset)
- New role-template + contract system
- Heavy workflow-state, recovery, merge coordination, dashboard and lease logic
- Significant test expansion around those systems

Why it is attractive:
- Real new functionality: multi-agent orchestration lifecycle, recovery loops, and operator visibility architecture are materially richer than baseline packs.

Why it is risky right now:
- Very large surface area; this is not a "small feature adopt."
- Prompt/role model and governance assumptions differ from this fork's current constitution and pipeline.
- High chance of partial adoption creating hidden coupling failures.

Specifier challenge prompts:
- What exact pain in our current system does `squad` solve first, measurably?
- What is the smallest independent `squad` slice that can run behind a flag without role-model rewrite?
- Which local constitutional invariants would be violated by direct `squad` prompt/contract import?
- If we do nothing, what specific failure class remains unaddressed?

### C) `swarm-forge` `two-pack` / `four-pack` / `six-pack` — **SKIP AS WHOLESALE ADOPT; MINE FOR PATTERNS**

Observed themes:
- Prompt pack restructures and role-count variants
- Handoff protocol and queue/daemon behavior shifts
- Shared article decomposition and prompt reorganizations

Why not wholesale adopt:
- These branches are alternative operating models, not isolated drop-in features.
- Large direct prompt replacement would collide with this fork's evolved local role semantics and review gates.

What to mine instead:
- Crisp handoff wording improvements where semantics already match local behavior.
- Any role-specific testability and "done" criteria refinements that can be transplanted without workflow topology change.

Specifier challenge prompts:
- For each candidate prompt borrowing, what local defect does it fix?
- Can we prove semantic equivalence against current local role contracts before import?
- Does the improvement still hold if we strip branch-specific workflow assumptions?

## Proposed intake decomposition (if accepted)

1. **Ticket 1 (high priority):** APS codex parity/adopt assessment with narrow behavior slices (parser inference + metadata path + CLI compat checks).
2. **Ticket 2 (discovery epic):** `squad` capability fit study with bounded pilot criteria and explicit no-import boundaries.
3. **Ticket 3 (prompt micro-adopts):** selective wording/rule adoptions from `two/four/six-pack` tied to concrete local defects.

## Non-goals for this intake

- No automatic watch-file bump.
- No branch merge/cherry-pick from upstream.
- No direct replacement of local role prompts in one pass.

## Decision request to specifier

Produce an intake decision note with:
1. Adopt / defer / reject per matrix row,
2. top three claims this intake might be wrong about,
3. one falsifiable acceptance scenario for each adopted slice.

---

## DISPOSITION (specifier, 2026-08-19)

Drained from the backlog root. The requested decision note lives in
`docs/upstream-deviations.md` ("2026-08-19 — upstream branch scan review").
Per-row outcome:

- Row A (APS codex/bb-tools-equivalence): ADOPT-CANDIDATE — one validation
  ticket minted, `backlog/paused/BL-959-aps-candidate-toolchain-equivalence.yaml`
  (epic code-quality-gates). Pin bump stays a human commit after evidence.
- Row B (squad): DEFER — no ticket; revisit triggers recorded in the note.
- Row C (two/four/six-pack): SKIP — six-pack already dispositioned 2026-07-17
  (BL-479); two/four-pack spot-checked already-have / not-applicable.
- Proposed decomposition Tickets 2 and 3: NOT minted (reasons in the note).
