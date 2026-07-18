# BL-515 Architect Bounce Evidence — foreign BL-519 work smuggled into the parcel

**Stage:** architect · **Date:** 2026-07-18 · **Reviewed parcel commit:** `350f30306d`
(from cleaner, task `BL-515-gherkin-lint-rejects-wrapped-step`)

## Verdict: SEND BACK to coder

The parcel forwarded to me under the BL-515 task name contains an **entire foreign
ticket's implementation (BL-519)** plus unrelated operator-artifact deletions. None of it
is on `main`, so if this rode through hardener → documenter → QA, QA's approval of BL-515
would land BL-519's code on `main` reviewed by no one.

This violates **constitution/workflow.prompt → "An Approval Authorizes Only Its Ticket's
Work — Don't Forward Foreign, Ticket-less Changes (BL-506)"**: a forwarded parcel's diff
against its base must map to its ticket's scope; functional files with no connection to the
ticket are a defect in the parcel — bounce it, never forward it.

## Evidence

BL-515's scope (per its ticket) is `swarmforge/scripts/gherkin_lint_gate.sh` + a pure
helper + `swarmforge/scripts/test/`. The core gate fix (`d844a335`) is already on `main`.
The only legitimate remaining BL-515 delta is the hardener's two coverage-gap test files.

`git diff --stat main 350f30306d` (the reviewed parcel) contains, beyond BL-515 scope:

- The full **BL-519** changeset — commit `31583487` "BL-519: inline constitution+PIPELINE
  into a cacheable stable-first bootstrap prefix", **586 insertions across 11 files**:
  `swarmforge/scripts/cache_warm_lib.bb`, `cache_warm_cli.bb`, `agent_runtime_lib.bb`,
  `agent_runtime_cli.bb`, `swarmforge.sh` (cache changes), `specs/pipeline/steps/
  bl519InlineConstitutionCacheSteps.js`, `specs/pipeline/steps/index.js`, the two bb test
  runners, `test_cache_warm_lib.sh`, `docs/tutorials/Onboarding-New-Project.md`.
- Deletion of `docs/briefings/2026-07-18.json` (−1265) and `docs/briefings/2026-07-18.md`
  (−42) — operator briefing artifacts, unrelated to BL-515, still live on `main`.

Confirming commands:

```sh
$ git merge-base --is-ancestor 31583487 main; echo $?
1                       # BL-519 is NOT on main — this parcel would introduce it
$ git log --oneline main..350f30306d | grep BL-519
31583487 BL-519: inline constitution+PIPELINE into a cacheable stable-first bootstrap prefix
$ git merge-base --is-ancestor 31583487 36c76187; echo $?
1                       # the hardener's real BL-515 tip does NOT contain BL-519
```

## Root cause of the contamination

The clean, properly-hardened BL-515 chain is `d844a335` (core fix, on main) →
`8e540eb9` → `36c76187` (hardener). `git diff --stat main 36c76187` is exactly the two
BL-515 files (`gherkin_lint_gate_lib_test_runner.bb` +15, `test_gherkin_lint_gate.sh` +20)
— no BL-519.

The cleaner's re-form merges `96339516` / `a659e9ab`, both titled *"clean re-form excluding
BL-519"*, re-merged the **coder branch tip**, which carries `31583487` (BL-519). So the
exclusion the merge messages claim **did not happen** — BL-519 is fully present in the tree.

## Required remediation (coder)

1. Re-form the BL-515 parcel from the clean hardener tip **`36c76187`** (merge current
   `main` into it to absorb the BL-519/BL-520 spec files, briefings, and INTAKE doc that
   `main` has since gained — merging `main` will NOT re-introduce BL-519's *implementation*,
   because `31583487` is not on `main`).
2. Do **NOT** include `31583487` (BL-519). Do **NOT** delete `docs/briefings/2026-07-18.*`.
3. Verify before forwarding: `git diff --stat main <new-commit>` must show **only** BL-515
   scope — `swarmforge/scripts/test/gherkin_lint_gate_lib_test_runner.bb`,
   `swarmforge/scripts/test/test_gherkin_lint_gate.sh` (+ this evidence file / the QA bounce
   evidence). No `cache_warm_*`, `agent_runtime_*`, `bl519*`, `swarmforge.sh` cache changes,
   or briefing deletions.
4. Preserve the hardener's lineage: `git merge-base --is-ancestor 36c76187 <new-commit>`
   must hold (that is what the earlier QA bounce `BL-515-bounce-20260718.md` required).

BL-519 is a legitimate separate ticket — it ships on its **own** parcel, never bundled into
BL-515.

By architect.
