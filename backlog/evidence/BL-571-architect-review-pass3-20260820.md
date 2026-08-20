# BL-571 — architect review pass 3 (post-QA-bounce re-fix): complete inventory

- **Ticket**: BL-571 — `rotation sequential` packs are invisible to ensure's declared signal (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `86a9a359cd` (cleaner) — re-fix for QA bounce D1
- **Reviewer**: architect, 2026-08-20
- **Prior bounces**: 2 — architect→coder (`behavior`, `bbb14382d8`, CLOSED at `71f250cb26`, pass 2); QA→coder (`integration`, `affac4f828`, closed by this re-fix). Verified against `origin/main`'s copy of the ticket, not my worktree's (BL-340): `bounce_count: 2`, both entries present, no third unfixed bounce.
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## What this re-fix actually is

`git diff 97d1d0e92 5b22ed2204` is **one file, +25 lines**: the ticket YAML.
No code changed since QA's bounce, which is exactly right — QA's own inventory
recorded *"The delivered CODE and TESTS are correct and complete; the single
defect is a missing ticket-record declaration."*

The cleaner's own delta (`5b22ed2204..86a9a359cd`) contains **no BL-571 code** —
only their evidence file plus BL-910/BL-959/BL-967 work riding the same batch
branch. Their "no code to clean" claim is accurate.

---

## Gates run this pass

| # | Gate | Result |
|---|---|---|
| A1 | Merge integrity — my HEAD vs sender tip `86a9a359cd` over every BL-571 path | **PASS** — diff is EMPTY. No BL-954-class silent drop, which mattered here because I bounced-and-reverted this ticket at pass 1. |
| A2 | QA's D1 remediation present | **PASS** — `abandoned_commits: ["17ae8a4822", "b7a6e580d7"]` at top level, **flow style**, avoiding the BL-935 block-list-with-comments trap QA explicitly warned about. |
| A3 | D1 declaration actually **parses** | **PASS** — parsed with `clj-yaml`; yields both ids as a real sequence, not a string. |
| A4 | `17ae8a4822` genuinely abandonable — **verified by content, not by trust** | **PASS**, and I checked harder than the bounce did. QA's check was "`git diff 17ae8a482 HEAD` deletes zero lines *mentioning BL-571*". That grep is narrower than the claim: the diff **does** delete `SWARM_ENSURE_*_CMD` seam lines, which mention no ticket id. I traced every one — all sit inside `Extra (BL-958)` / `Extra (BL-958 D1)` blocks, correctly excluded because BL-958 was still bounced when the parcel was cut (BL-506). The BL-571 content of `17ae8a4822` is present as a **superset** (corrected seam names PLUS the hardener's `fake_daemon_start.sh` stub and the `SWARMFORGE_SKIP_CURSOR_BRIDGE`/`SKIP_BABYSITTERD` fences). |
| A5 | `b7a6e580d7` genuinely abandonable | **PASS** — it is QA's own merge whose subject reads *"BL-571 content kept reverted per its open QA bounce"*; `git diff b7a6e580d7 HEAD` shows HEAD **adding** every BL-571 path (steps +270, mono_router_lib +58, parity gate +99). It is *behind* on BL-571, so abandoning it drops nothing, and merging it would drag BL-957/BL-958/BL-960 riders. |
| A6 | My own pass-1 D1 (BL-897 parity gate) survived | **PASS** — `mono_router_lib_test_runner.bb:775-807` still derives the launcher's accepted set by parsing `is_sequential_dormant` out of `swarmforge.sh` and asserts **set equality** with `single-resident-rotation-values`. Not re-suppressed by any intervening revert. |
| A7 | Dependency-rule gate (BL-259, **hard gate**) | **RUN**, exit 1 on the pre-existing `out/tools/telegram*` `acyclic` cycle only. Verified pre-existing (edges exist at `origin/main`) and this parcel touches **no** telegram file. Not a BL-571 defect. |
| A8 | Co-change coupling (BL-255) | **RUN**. Top signal is `swarm_ensure.bb` ↔ `test_swarm_ensure.sh` (20) and ↔ `swarmforge.sh` (13). The second is precisely the cross-language mirror my pass-1 D1 was about — and it is now gated by A6 rather than left to a comment. The tool's top hit is the coupling this ticket fixed. |
| A9 | `qa_e2e` step 1 — `test_swarm_ensure.sh` (the invariant's end-to-end half) | **PASS — 45/45, ALL PASS, exit 0**, reproduced on **two independent runs**. Matches the cleaner's C5 and QA's G4 counts exactly. |
| A10 | `qa_e2e` step 2 — `mono_router_lib_test_runner.bb` (carries the BL-897 parity gate) | **PASS** — `ok`. |
| A11 | Fixture leaks from my own runs | **PASS** — no fixture-rooted `handoffd`/`babysitterd`/`supervisor` left behind. |

## Declared-invariant pass (BL-633/BL-654)

Invariant: *"Under every rotation value that means single-resident, ensure never
respawns a role the launcher deliberately left dormant."*

| Check | Result |
|---|---|
| Executable property test exists | **YES** — `swarmforge/scripts/test/bl571_single_resident_rotation_property_runner.bb`. |
| Passes | **YES** — `ok (300 runs, 146 positive, 67 sequential, 154 negative)` — a real distribution, not a degenerate one. |
| **Non-vacuity re-proven by me** (not taken on the author's word) | **YES** — narrowing `single-resident-rotation-values` to `["router"]` in a scratch copy produced **134 failures**, naming the sequential rows exactly (`launcher-accepted conf not recognised: "…rotation sequential"`). Restored. |
| The delegated half is real, not a dodge | **YES** — the runner states the "ensure never respawns" tail is asserted end-to-end by `test_swarm_ensure.sh` rather than a generator. I verified both fixtures exist: the router case (empty-respawn-log assert, line 530) **and** this ticket's sequential twin (lines 534–585, asserting `agent:specifier: DORMANT` with an empty respawn log). Unlike BL-967's structural claim, which I falsified this shift, **this one holds**. |
| Violations found | **NONE.** |

## Architecture review

- **Deliberate duplication left in place**: `swarm_ensure.bb`'s `rotation-router-mode?`
  repeats the identity-else-conf resolution `mono_router_lib/resolve-rotation-router-mode?`
  performs. Refused consolidation is **correct** here — the ticket's own "Out of scope"
  section defers the four-call-site refactor to its own ticket and names it as the
  scope creep "An Approval Authorizes Only Its Ticket's Work" (BL-506) forbids. A
  legitimate sibling deferral, documented with rationale rather than silently skipped.
- Two-layer boundary, extension-host-owns-IO, no webview storage, no secrets in the
  tree, integrate-not-fork: all untouched by this parcel (Babashka/bash only).

## Observation for QA at landing — not a defect, no bounce

Merging this parcel into the **current** `origin/main` will **conflict** in
`swarmforge/scripts/test/test_swarm_ensure.sh` (3 hunks). I simulated the three-way
merge (base `acf5198588`, ours `origin/main`, theirs `86a9a359cd`) rather than
reasoning about it:

- **No silent sibling loss.** The merged result retains **15** `BL-958` references
  **and** **6** `BL-571` references. The merge base already lacked BL-958's blocks,
  so BL-571 deletes nothing that main added — I checked this specifically because
  BL-958 has since **landed** on `origin/main` (`control_plane_lib.bb` present there)
  while this parcel was cut when BL-958 was still bounced.
- The conflicts are **pure adjacency**: BL-571's hardening comment and BL-958's
  `Extra (BL-958)` blocks occupy the same region. Correct resolution is **keep both
  sides**.

Flagging it because the failure mode here is a known recurring one — resolving such
a conflict by dropping a side silently reverts a landed sibling. The markers are
visible, so nothing is silent if QA resolves deliberately.
