# INTAKE — Upstream unclebob/swarm-forge drift survey (2026-09-29)

**Source:** human via Cursor, 2026-09-29 ~23:04 BST, verbatim:
"also, do the diff with bob's upstream swarm and see if there are any good
ideas to implement for us"

Companion ask in the same session as the local-specifier recruiter intake
(`backlog/INTAKE-recruiter-local-specifier-hf-battery-20260929.md`) — this is
a **separate** intake: upstream idea mining, not model recruiting.

**Mechanism:** BL-477 drift-watch
([`upstream-watch.json`](../upstream-watch.json),
[`docs/upstream-deviations.md`](../docs/upstream-deviations.md)). Last full
disposition of Bob's pack branches: 2026-08-19. Watch baselines for
`unclebob/swarm-forge` still sit at July SHAs; live heads have advanced.

## Drift check (ran 2026-09-29)

```text
DRIFT unclebob/swarm-forge main:       9acd54d2… → f4f5fbcae…  (~73 commits)
DRIFT unclebob/swarm-forge adversaries: 7aa2f3a2… → 68d52bbc…  (docs only)
NEW-BRANCH lieutenant @ 23653942…      (2026-09-07 tip)
NEW-BRANCH project-manager @ 2cc1795f…
NEW-BRANCH sprint-module-squad @ 63693c14…
NEW-BRANCH squad @ 319801e1…           (still moving / experimental)
NEW-BRANCH two/four/six-pack           (tips moved for instruction-arch docs)
NEW APS codex/bb-tools-equivalence @ 27e99156…  (was 1001283af at BL-959)
```

No common git ancestor with this fork — adoption is always **manual
reimplementation**, never merge/cherry-pick (Architecture Rule 2).

## Already have (do not re-litigate)

| Upstream idea | Our equivalent |
|---------------|----------------|
| `back-one` / `back-all` reverse `git_handoff` | Landed; `swarmforge.sh` + handoff protocol + cleaner/architect prompts |
| 100-site mutation split before handoff | BL-485 + `cleaner.prompt` threshold 100 |
| Property-test owner = architect | BL-479 |
| Specifier hold until human approval | `human_approval: pending` + Approvals topic |
| Handoff self-audit before queue | BL-1306 two-call challenge (different shape from upstream dashboard `audit_pending`) |
| Operator glance UI | Bubble + Telegram pipeline board / briefing (not their pack HTML cockpit) |

## Adoption matrix (for specifier)

### A) Engineering: "IO-near modules must not reimplement a domain answer" — **ADOPT (prompt rule)**

Upstream `main` `d1e401a` (2026-09): *If a high-level module already answers a
domain question, call it and translate — walking the same facts again is a
defect even when the dependency arrow points inward.*

**Why for us:** our extension is full of thin CLIs / adapters over bb libs;
re-deriving domain verdicts in TypeScript has bitten us (duplicate readers,
divergent gate answers). One constitution line + a standing architect/cleaner
check is cheap and INVEST-valuable.

**Challenge:** name 1–2 recent local defects this would have prevented, or
SKIP as already covered by thin-wrapper / single-reader rules.

### B) Engineering: split on mixed jobs, not to chase the site count — **ADOPT (refine BL-485)**

Upstream `main` `cc8d63b` / `1ef0cd6` refinement: mutation-site scan is a
**hint** a module mixes jobs; **do not** split a one-job module just to get
under 100 sites.

**Why for us:** we adopted the threshold; without the "not to chase the count"
half, cleaners can over-split. Amend `cleaner.prompt` / engineering wording
only — no new tooling.

### C) APS `codex/bb-tools-equivalence` tip advance — **ADOPT-CANDIDATE (validation ticket)**

Since BL-959's candidate `1001283af`, the branch gained
`5758904 Keep and mutate Gherkin step data tables` (+ `27e9915` cleanup):
parser keeps `|` rows on steps in IR; mutator mutates table cells like
Examples.

**Why:** real acceptance power for table-heavy features; our pin is still
`accaa33d`. Same discipline as BL-959: dual-run corpus, shim plan, **human**
pin bump. Do not silently bump.

### D) Lieutenant / project-manager / platoon multi-project forge — **DEFER**

Host lieutenant + `projects/` dashboard + platoon brainstorm
(`platoon-brainstorm.md`: lieutenant coordinates multiple pack "squads").

**Why not now:** strategic reimplementation; our coordinator + front desk +
Bubble already own operator chat and multi-swarm fleet differently. No named
local pain that "multi-project forge host" uniquely solves today.

**Revisit when:** (a) we want a true multi-repo forge product, AND (b) Telegram
/ Bubble cannot cover the operator control plane.

### E) Pack HTML cockpit / Attention / dashboard heat — **SKIP wholesale; mine selectively**

Upstream built a Playwright-tested pack dashboard (cards, Attention, heat,
clarifications). We deliberately went Telegram + Bubble.

**Maybe mine later (only with a named defect):** "retry rejected handoff as
audit" and "per-document Attention review" as *disciplines* on our Approvals /
Recert surfaces — not a port of their HTML.

### F) `squad` / `sprint-module-squad` — **DEFER (confirm 2026-08-19)**

Still experimental (README says not a `get-swarm-forge` product). Dynamic
workers + sprint-0 framing are interesting but a full control-plane rewrite.
Same revisit triggers as the Aug 19 SKIP/DEFER: stabilize + named local
failure class our pipeline cannot address.

### G) Adversaries branch tip — **SKIP**

Only documentation commits since BL-478's SKIP of the adversarial-reviewer
role. No new role surface.

## Recommended first slices (1:N hint)

1. **Prompt adopt A+B** — one small ticket: add the domain-answer / no-chase-count
   lines to the right constitution / cleaner surfaces; evidence = grep + one
   architect-facing example.
2. **APS step-data-table validation** — BL-959-shaped ticket against tip
   `27e99156`; report only; pin bump stays human.
3. **Optional fit note (no build):** one-page lieutenant/platoon vs our fleet
   coordinator — defer/build decision recorded in
   `docs/upstream-deviations.md` without code.

## Firm constraints

- Do **not** advance `upstream-watch.json` SHAs in the same commit as code
  adopts — advancing "reviewed up to here" is a human commit after reading
  this disposition (or a follow-on evidence file).
- Do **not** break the live swarm to try lieutenant/squad.
- Preserve human sentences from this intake verbatim (Article 5.3).

## Evidence pointers

- Live survey clone: `/tmp/unclebob-swarm-forge-survey` (disposable)
- Prior dispositions: [`docs/upstream-deviations.md`](../docs/upstream-deviations.md)
- Aug 19 matrix:
  [`backlog/archive/INTAKE-20260819-upstream-adoption-matrix-for-specifier.md`](archive/INTAKE-20260819-upstream-adoption-matrix-for-specifier.md)
- BL-959 APS report:
  [`backlog/evidence/BL-959-aps-equivalence-report.md`](evidence/BL-959-aps-equivalence-report.md)
- Drift CLI: `bb swarmforge/scripts/upstream_drift_check.bb upstream-watch.json`

## Disposition

Leave in `backlog/` for the specifier. After mint/close, append a 2026-09-29
entry to `docs/upstream-deviations.md` and (human) advance watch SHAs for
branches that were fully dispositioned.

## Specifier disposition (2026-09-29)

Split 1:N (Consolidation Authority, BL-680) into epic **BL-1810**
(`upstream-drift-adoption`) and three slices, as the intake recommended:

- Row A (domain-answer rule, upstream d1e401a) and row B (split on mixed
  jobs, upstream cc8d63b) -> **BL-1811**. A adopted: the specifier landed
  the prose at mint (engineering.prompt index line,
  engineering-detailed.prompt, architect.prompt, cleaner.prompt). B is
  already covered by cleaner.prompt's BL-485 section; only an attribution
  line was added.
- Row C (APS codex/bb-tools-equivalence at 27e9915678, step data tables)
  -> **BL-1812**, a BL-959-shaped report; the pin bump stays human.
- Row D (the podium-agent fit note) and the 2026-09-29 log entry for rows
  A-G -> **BL-1813**. Rows E, F and G get no ticket of their own; BL-1813
  records them in docs/upstream-deviations.md.

The human's sentences quoted above survive verbatim in BL-1810's
`source:`. Vocabulary: during the mint the human asked, verbatim, "can
you adopt the orchestra lexical terms instead of army jargon" and "refer
to baton epic"; the tickets use Baton's orchestra lexicon (BL-242), and
this archived intake keeps its original wording as history.
