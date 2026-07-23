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
