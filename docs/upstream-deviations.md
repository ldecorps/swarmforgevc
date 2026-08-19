# Upstream Deviations Log

This is the review log `swarmforge/constitution/articles/local-engineering.prompt`
(Architecture Rule 2) refers to: a human-readable record of each upstream
drift-watch review and the adopt / skip / already-have decision made for it, so a
deliberate divergence in this heavily-diverged fork is documented once rather than
re-litigated on every future check.

## Mechanism (BL-477)

- `upstream-watch.json` (repo root) records the last-**reviewed** commit SHA per
  watched upstream repo/branch — the baseline "we have looked at everything up to
  here."
- `swarmforge/scripts/upstream_drift_check.bb` reads that baseline, `git ls-remote`s
  each watched repo, and reports any branch whose live head has advanced past the
  recorded SHA, or any branch present upstream with no entry in the watch file at
  all. It is strictly read-only — it never fetches into the working tree, never
  rewrites the watch file, and never bumps an install pin.
- Advancing a watch SHA (recording "reviewed up to here") is always a human
  decision, made by editing `upstream-watch.json` directly — exactly like bumping
  an install pin in `swarmforge.lock.json`, and never something the check script
  does itself.
- This fork has **no common git ancestor** with `unclebob/swarm-forge` (verified
  2026-07-17: `git merge-base HEAD ub/main` = none), so adopting anything found by
  a drift review is always a manual, deliberate reimplementation reviewed by a
  human — never a git merge/cherry-pick the tooling performs.

## Review log

### 2026-07-17 — baseline review (BL-477)

The mechanism this file and `upstream-watch.json` implement did not exist before
this review; this entry seeds the baseline rather than recording a *change* since
a prior review.

| Repo | Branch | Reviewed SHA | Decision |
|------|--------|-------------|----------|
| unclebob/swarm-forge | main | `9acd54d2239fef7e41ddacd8fd30dfb0e69672fe` | Baseline seeded. No common ancestor with this fork — any future adoption is a manual, human-reviewed reimplementation, never a git merge/cherry-pick. |
| unclebob/swarm-forge | adversaries | `7aa2f3a2691ed92e26a11be4481d7d5c8e2ff859` | Baseline seeded. One novel element found on this branch during the 2026-07-17 survey; dispositioned separately (BL-478 evaluates it). |
| unclebob/Acceptance-Pipeline-Specification | main | `accaa33d503340c56513ef387258f8da929ba902` | Baseline seeded. Already have it — this SHA equals `swarmforge.lock.json`'s current APS install pin. |

**Not tracked in `upstream-watch.json`:** APS's `codex/bb-tools-equivalence` branch
(observed 2026-07-17 at an abbreviated `3a1d7b06...`) is not reachable from APS
`main` and is therefore not adoptable via a simple pin bump either way. It is
recorded here as context for the next full review, not added as a tracked branch
pending a closer look at what it actually contains.

### 2026-07-17 — `six-pack` deep-dive (BL-479)

A same-day follow-on survey, deeper than the baseline review above: read every
role prompt on `unclebob/swarm-forge` `six-pack` and checked each idea against
this fork's prompts, reporting only what was genuinely absent here.

| Finding | Decision |
|---------|----------|
| Property testing has no owner — `engineering.prompt` already legislates property tests as a separate verification category, but no role prompt claims it. Upstream's `six-pack` architect.prompt closes the hole: the architect owns property-test support after architectural review, before the hardener. | **ADOPT** (adapted, not ported). `architect.prompt` gained a "## Property Testing" section (human-approved wording); `hardender.prompt`/`QA.prompt` reference the separate `npm run test:properties` command. `fast-check` is now a pinned devDependency, wired through its own `vitest.properties.config.mjs`, excluded from the normal unit/coverage/mutation run. Seeded with one non-vacuous property suite (`benchmarkAggregate.property.test.js`) — demonstrated to fail when its invariant is deliberately broken, then restored. |
| Upstream's `six-pack` cleaner has a mutation-site SIZE gate this fork's cleaner lacks: scan/count mutation sites on changed files (without running mutation) and split a file exceeding 100 sites before handoff. | **ADOPT** — built as BL-485: a Stryker instrument-only count helper (`extension/src/tools/mutation-site-count.ts`), counting against `out/`-mapped compiled sources (never `src/`), threshold-verdict only, no mutation loop run. `cleaner.prompt`'s "## Mutation-Site Size" governance wording is a separate human-reviewed step, tracked on BL-485 itself. |
| Everything else in the `six-pack` role prompts (differential mutation vs. manifest, soft Gherkin mutation, end-to-end QA suite concept, APS Gherkin-parser discipline) | **Already have it** — verified by grep against this fork's own prompts, not assumed. |

### 2026-07-17 — adversarial-reviewer role (BL-478)

Evaluates the one genuinely novel element the baseline survey found on
`unclebob/swarm-forge`'s `adversaries` branch (`7aa2f3a2`): a dedicated
**adversarial-reviewer** role (`swarmforge/roles/reviewer.prompt`, +44) that
red-teams the coder's work and files sequenced recommendation files into the
pipeline. Everything else on the branch (daemon-backed handoff protocol,
constitution-articles refactor, shared engineering/workflow/handoff articles,
"prefer Babashka APS tools", stable handoff-request procedure) this fork already
has independently — verified during the 2026-07-17 survey, not assumed.

**Decision: SKIP** — do not add a dedicated adversarial-reviewer role. Its intent
is already structurally covered, and the cost/benefit is decisively negative under
this fork's current constraints. A negative result is the recorded outcome; no
follow-up build ticket is filed (per the ticket contract, SKIP records the
"already covered" finding and closes).

Reasoning:

1. **Three downstream review stages already cover the intent** — stages upstream's
   simpler pack lacked when the `adversaries` branch was authored. The reviewer's
   purpose (independently red-teaming the coder's implementation for correctness,
   security, and edge cases) is spread across: the **architect**, which issues
   *correctness* send-backs to the coder, not only design review (see
   `architect.prompt`'s "a correctness defect you can SEE is a send-back too"
   rule); the **hardener**, whose mutation/CRAP gate red-teams the *tests*
   themselves ("does a surviving mutant prove a missing assertion?"); and **QA**,
   an independent final gate in its own worktree that re-verifies acceptance and
   runs the live e2e procedure. A fourth reviewing role would overlap all three.
2. **Adversarial review is already a first-class DISCIPLINE here, not just a role.**
   `engineering.prompt` is dense with adversarial "a green suite is not proof"
   rules (missing-seam, call-site-sweep, shared-global, in-process-`main()`,
   sweep-failure-contract), and the **`rule_proposal` loop** lets any role escalate
   a newly-observed systemic gap into the constitution — a continuously-hardening
   adversarial layer no single static upstream role provides.
3. **Cost/benefit is negative under the current fleet-host constraints.** A new
   pipeline role means a new resident worktree and a standing agent session. The
   fleet host is a 15GB box that OOM-crashed holding ONE full swarm — the very
   evidence that drove the BL-448 mono-rotate decision. Adding a standing role
   worsens exactly the resource pressure we just spent a ticket relieving; a whole
   role to fill a seam already substantially covered is not worth the memory + token
   cost.
4. **No common git ancestor** with `unclebob/swarm-forge` (`git merge-base HEAD
   ub/main` = none), so adoption is a full manual reimplementation of a prompt
   written for a simpler pipeline, then maintained against this fork's diverged
   constitution — high ongoing maintenance cost for marginal, overlapping value.
5. **A lighter path exists if a real gap ever appears.** If a future incident shows
   architect+hardener+QA structurally missing an adversarial-correctness class of
   defect, the response is a targeted `rule_proposal` sharpening the architect's or
   QA's remit — or use the existing `/code-review` adversarial tooling on a diff —
   neither of which requires a standing role. **Revisit trigger:** a concrete
   escaped-defect that all three existing review stages structurally could not have
   caught; absent that evidence, adopting a role pre-emptively is unwarranted.

### 2026-08-19 — upstream branch scan review (intake decision note)

Disposition of `backlog/INTAKE-20260819-upstream-adoption-matrix-for-specifier.md`
(archived to `backlog/archive/`), which asked the specifier, verbatim: *"Produce
an intake decision note with: 1. Adopt / defer / reject per matrix row, 2. top
three claims this intake might be wrong about, 3. one falsifiable acceptance
scenario for each adopted slice."* This entry is that note. No
`upstream-watch.json` SHA is advanced by it — recording "reviewed up to here"
stays a human commit.

| Repo / Branch | Head at review | Decision |
|---------------|----------------|----------|
| APS `codex/bb-tools-equivalence` | `1001283af` (2026-08-14) | **ADOPT-CANDIDATE — one validation ticket, BL-959.** The branch sits directly on our install pin (`git merge-base` with APS `main` = `accaa33d…` exactly), so adoption is an atomic human pin bump after evidence — not the intake's "targeted slices" (per-command adoption is unavailable: engineering.prompt forbids reimplementing APS commands, and `install_aps_tools.sh` vendors atomically at the lock-file SHA). 7 commits, not the intake's 5; probe classifies 2 as behavior changes for our consuming surface (`3a1d7b063` parser default-parameter inference — changes the IR feeding our lint gate, IR-DRY, and mutation-site enumeration; `1001283af` mutation metadata → work dir), 5 as porting/docs (`1847a252e` "remove go tools" is a no-op for us — we vendor bb-only, so the intake's "consolidates around Babashka, lower Go/BB split-brain" payoff is already our posture). BL-959 dual-runs pinned vs candidate over the real corpus and reports; the bump itself stays human. |
| `unclebob/swarm-forge` `squad` | `4a8f3bc16` (2026-08-19) | **DEFER — no ticket, not even a fit-study epic.** All 168 commits landed within the last month and the tip moved the very day of the scan: a fit study now evaluates a moving target and is stale on arrival. No measurable local pain has been named that `squad` solves first (the intake's own challenge prompt, unanswered). And this fork has no common git ancestor with upstream, so "smallest slice behind a flag" is not an import — it is a reimplementation program. **Revisit triggers:** (a) `squad` stabilizes (multi-week quiet tip or merged to upstream `main`, where the tracked-branch drift check fires anyway), AND (b) a concrete, evidenced local failure class our current pipeline structurally cannot address — same trigger discipline as the BL-478 SKIP. |
| `unclebob/swarm-forge` `six-pack` | `59803dadb` (2026-07-06) | **Already dispositioned — not new.** Deep-dived 2026-07-17 (BL-479, entry above): two adopts landed (property-testing owner; mutation-site size gate), everything else verified already-have. Zero commits since (tip predates that review). The scan reports it only because it is absent from `upstream-watch.json` — a bookkeeping gap, not unreviewed content. |
| `unclebob/swarm-forge` `two-pack`, `four-pack` | `892b1f22a` (2026-06-29), `f17aeec71` (2026-06-24) | **SKIP wholesale (confirming the intake); no pattern-mining ticket either.** Both are role-count operating-model variants whose tips predate the 2026-07-17 review cycle; six-pack (the variant closest to this fork's 7-role pipeline) was already mined. Spot-checked notable subjects against this fork: "prune identical Gherkin columns" — already in specifier.prompt verbatim; "Require task name in specifier handoffs" / "Require abbreviated handoff commit hashes" — already in the handoff protocol (stable task names, 10-hex commits); "Tell agents not to restart swarm for helpers" — already in Worktree Discipline; logbook/Speclj/Babashka-project-language items — target upstream's Clojure projects, not applicable to this TS extension. Pattern-mining without a named local defect fails INVEST (Valuable); if a concrete defect later matches an upstream wording, adopt it then via `rule_proposal`. |

**Top three claims the intake might be wrong about** (per its own request; all
three were confirmed wrong or materially off by probe):

1. **"New branches: two-pack, four-pack, six-pack, squad."** Wrong for the
   packs: all three tips predate 2026-07-17 with zero commits since, and
   six-pack was fully deep-dived and dispositioned that day (BL-479). "New"
   only means "absent from the watch file". Row C mostly re-litigates a
   settled review — the exact thing this log exists to prevent.
2. **"Adoption can be sliced by command/tool behavior" (Row A).** Wrong as a
   mechanism: APS adoption is an atomic human pin bump + re-vendor;
   reimplementing individual APS commands is forbidden. Slicing applies to
   *validation* only. (Also the headline commit list missed 2 of 7 commits.)
3. **"Ticket 2: `squad` discovery epic" with a "smallest slice behind a
   flag".** Assumes an importability that does not exist (no common
   ancestor → reimplementation only) and a stable target that does not exist
   (168 commits in the last month, tip moving on scan day).

**Falsifiable acceptance scenario for the one adopted slice** (BL-959, from
`specs/features/BL-959-aps-candidate-toolchain-equivalence.feature`): given a
pinned-run and a candidate-run result set over the same corpus where the
candidate records a differing (or missing) lint-gate outcome for exactly one
corpus entry, when the equivalence comparator runs, then the verdict matrix
marks exactly that entry DIVERGENT (or INCOMPLETE) naming the lint gate and
the comparator exits non-zero — deliberately breaking one fixture's candidate
result MUST flip the exit to non-zero, or the harness is refuted.

### 2026-08-19 — local deviation: launcher diagnostics moved to stderr (BL-947)

Not a drift review — a deliberate local change to the fork's own
`swarmforge/scripts/swarmforge.sh`, recorded here per Architecture Rule 2 so a
future upstream comparison reads the divergence as intentional rather than
drift.

| Change | Rationale |
|--------|-----------|
| All 27 `echo -e "${RED}Error:${RESET} ..."` diagnostics now route through one `error_msg()` helper that writes to **stderr** (`>&2`). Message text, colouring and every exit status are byte-identical — only the channel changed. | stdout carries VALUES: callers capture command substitutions (the control socket path is the live example), so a diagnostic on stdout corrupts the captured value and reads as silence to anything watching stderr. BL-944's evidence misdiagnosed a socket-path refusal as "no output" for exactly this reason. A standing guard (`extension/test/swarmforgeShErrorChannelGuard.test.js`, over `specs/pipeline/steps/lib/swarmforgeShErrorChannel.js`) keeps the next error line off the wrong channel. |
