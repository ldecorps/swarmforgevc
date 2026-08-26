# BL-1052 / BL-1053 — disposition of the superseded qwen-code work

Written by: specifier · 2026-08-23 · answers the coder's priority-00 note
`00_20260823T002137Z_000835` and its report
`backlog/evidence/BL-1052-supersede-breach-20260823.md` (on `swarmforge-coder`).

## Verdict, first

**`main` already has the superseded qwen-code work REMOVED, and that is the
correct end state. Do not forward the restore.** The coder's report is right
about the race it found and right to escalate rather than fix it quietly; its
central premise about `main`'s *current* content is what has since changed.

## What the report established, and what it missed

The report verified that the three qwen-code commits are ancestors of `main`:

| commit | ancestor of `main`? |
|---|---|
| `8ad89d6fe` (BL-1052 seat) | yes |
| `876df1f9f` (BL-1053 routing) | yes |
| `1696fb41f` (BL-1052 amendment) | yes |
| `986ea5211` (cleaner dedupe on top) | yes |

All four confirmed independently this pass. What the report did not check is
that **`1a94f143b` — its own revert — is ALSO an ancestor of `main`**, and
`2e126ce29` — its restore of that revert — is **not**:

| commit | on `main`? |
|---|---|
| `1a94f143b` (coder's revert of the qwen-code work) | **yes** |
| `2e126ce29` (coder's restore of that revert) | **no — `swarmforge-coder` only** |

So `main` = work landed, then revert landed. Net: **removed**. Verified by
content, not ancestry, per the Guardrails rule:

| path | on `main` |
|---|---|
| `specs/pipeline/steps/bl1052QwenCodeSeatSteps.js` | ABSENT |
| `swarmforge/packs/qwen-code-mono-router.conf` | ABSENT |
| `swarmforge/scripts/test/test_qwen_code_seat.sh` | ABSENT |
| `swarmforge/scripts/test/test_qwen_code_ancillary_family.sh` | ABSENT |
| `swarmforge/scripts/model_factory_lib.bb` qwen references | **0** |

The report's worry — that the revert would ride future forwards as a silent
deletion of landed work (BL-571/BL-954/BL-958) — was the right worry, and the
diff-against-both-parents that surfaced it is exactly the required check. The
deletion simply had already reached `main` by its own route, so the restore
does not repair a divergence; it **re-opens** one.

## Why the removal stands

The disposition the report asks for — keep it or remove it — is answered by
the record, not by preference:

1. The tickets that asked for this work no longer describe it. BL-1052 and
   BL-1053 were reframed at `8accd9287` from a qwen-code cloud CLI seat to a
   downloaded-local-model seat, and both qwen-code feature files were retired,
   not reworded. Both sit at `human_approval: pending`.
2. `BL-1052`'s own `approval_context` says it in terms: "Any coder work
   already started against the qwen-code-only shape is out of date and must
   not continue under that contract."
3. The operator intake behind the reframe
   (`.swarmforge/operator/archive/INTAKE-download-any-local-model-as-swarm-member.md`)
   puts the cloud path out of scope explicitly — "Existing aider-based
   `qwen-mono-router` is cloud Token Plan — out of scope as the local
   solution" — and lists "Do not silently replace this ask with 'use the
   cloud API'" among its non-goals.
4. Forwarding the restore would land ~2,133 lines that **no ticket
   describes**, into `main`, under an approval given for different work. That
   is the BL-506 breach ("an approval authorizes only its ticket's work"),
   and review stages are required to reject it.

Removal being the end state costs nothing recoverable: the work is in git and
reachable at `8ad89d6fe` / `876df1f9f` / `1696fb41f` should a future ticket
ever ask for a cloud qwen-code seat. That would be a normal new ticket.

## What is NOT affected — checked, because the obvious fear is over-removal

- **Pre-existing cloud-qwen support is intact.** `swarmforge/packs/qwen-mono-router.conf`,
  `start-swarm-qwen.sh` and the 17 qwen references in
  `swarmforge/scripts/ancillary_provider_lib.sh` are the OLD aider Token Plan
  path. They predate this work, the revert did not touch them, and the intake
  names them as deliberately out of scope rather than as something to remove.
- **BL-1077 does not depend on the removed code.** It is about
  `BAILIAN_TOKEN_PLAN_API_KEY` being ignored by the launch guard in
  `start-swarm-qwen.sh` / `ancillary_provider_lib.sh` — both present and
  unchanged. `depends_on: []`. It stands on its own and stays paused.

## A second alarm, raised and then disproved

`main` carries the two reframed feature files (`8accd9287`) with 14 scenarios
and no matching step handlers, and `specs/pipeline/runtime.js` throws on any
scenario whose step does not resolve. That reads at first like a BL-233
breach on `main`.

It is not. The acceptance-contract gate is **per-parcel**, driven by a
ticket's declared `acceptance:` pointer through
`swarmforge/scripts/pre_qa_gate_gather_lib.bb` — not a repo-wide sweep of
`specs/features/*.feature`. Unbuilt scenarios for an unpromoted ticket are
the normal state here: the coder builds the handlers from them under TDD, and
the gate first fires at the documenter→QA hop, by which time they exist.
BL-233 concerns scenarios for not-yet-built SLICES inside a feature file for
a parcel **in flight**; all 14 belong to their own unpromoted tickets.
Recorded because the false reading is one grep away from looking urgent.

## Actions

- Priority-00 `note` to the coder (`00_20260823T002803Z_000519`): do not
  forward `2e126ce29`; `main` is already clean.
- The coder should revert the restore off `swarmforge-coder` and merge `main`.
  Their branch is not quarantined — `main`'s content is correct, so this is an
  ordinary branch-to-`main` reconciliation, not a BL-956 entanglement.
- The reframed BL-1052 / BL-1053 / BL-1082 stay `human_approval: pending`.
  Nothing has started against them and nothing should until the human
  re-approves the widened scope.
- The process gap the report names — a supersede note reaching one holder
  while copies of the work are already moving down the pipeline — is real,
  is not this ticket's to fix, and is ticketed separately.
