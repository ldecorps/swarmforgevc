# BL-1069 — QA bounce — 20260822

Full-pass verification (Article 4.4, complete inventory). Every check below
ran to completion. One defect survives, in the hardener's own domain,
explicitly self-acknowledged as incomplete in the hardener's own evidence
file rather than hidden.

## D1 — BL-113 Gherkin mutation: 12/29 survivors on scenario 1, not fixed, not proven equivalent (hardener, `behavior`)

**Failing command:** N/A — QA does not run mutation tooling (role boundary;
this includes Gherkin mutation, named explicitly in this prompt's "Does Not
Own"). Sourced from reading the hardener's own evidence in full,
`backlog/evidence/BL-1069-BL-991-BL-1029-BL-1075-hardener-batch-20260822.md`,
and independently confirmed the described mechanism by reading the step
handler.

**Commit hash tested:** `d7ca665024` (documenter's forward; hardener's own
batch commit `f242fe621` — "BL-1069/BL-991/BL-1029/BL-1075: harden — fix a
third generator-seeding defect, run BL-113 across all four" — confirmed an
ancestor of it).

**First error excerpt (quoted verbatim from the hardener's own evidence
file):**

> BL-1069 | ... | scenario 3 (installer): 2/2 killed. **Scenario 1 ("the
> version verdict is read from the server, not the client") has 12/29
> survivors** — see below, NOT fixed this pass
>
> The step handler (`bl1069TmuxServerVersionSteps.js`) already declares
> `KNOWN_VERDICTS` and validates the row's declared verdict against it, but
> does not pin the client/server version VALUES themselves against a
> declared literal set before the real comparison runs them...
>
> **Not fixed in this pass, given session time constraints**, but explicitly
> NOT silently passed either.

Independently confirmed by reading `specs/pipeline/steps/bl1069TmuxServerVersionSteps.js`
directly: `KNOWN_VERDICTS` (line 42) validates only the row's declared
`warned`/`silent` outcome; grepping the file for any `KNOWN_EXAMPLE_VALUES`-
style literal pin on the client/server version strings themselves finds
none. The described gap is real, not a mischaracterization.

**Failure class:** `behavior` — a gate-compliance gap, not a crash; same
precedent used in this prompt's own routing table and in my own BL-1015
bounce earlier this session.

**Expected vs observed:** Expected — `swarmforge/roles/hardender.prompt`'s
own BL-113 rule: "A SURVIVED [Gherkin mutant] names the scenario and the
mutated value that got through unnoticed — treat it the same as an
uncovered Stryker mutant: add or sharpen a step handler assertion... then
re-run." Article 4.1 gate 3 ("no surviving mutants") does not carve out the
Gherkin-acceptance layer as advisory; this prompt's own hardener rules treat
it identically to language-level mutation. Observed — 12 of 29 mutants on
scenario 1 survive, explicitly left unresolved "given session time
constraints," with no equivalence argument offered (contrast the SAME
evidence file's BL-1029 item, three lines below, where 3/3 survivors ARE
individually justified as equivalent per BL-234 — the correct way to close
a survivor without a code fix, and the way this item was NOT closed).

**Mitigating factor, noted for the record, not a substitute for the gate:**
the underlying comparison logic (`version_key`/`version_lt?`) that this
scenario's acceptance layer is meant to pin has independent, rigorous
coverage from BL-1069's own property test (a real oracle, a proven
non-vacuous break-and-revert at authoring time, per the hardener's own
evidence and the architect's independent re-verification). The production
logic is very likely correct. The gap is specifically in the ACCEPTANCE
layer's fidelity to its own Example values — a real, if narrower, instance
of the same "gate left unmet, deferred for time, not equivalence-proven"
shape as this session's BL-1015 bounce (CRAP<=6 unmet on 6 functions,
`backlog/evidence/BL-1015-...-bounce2-20260822.md`). Applying a different
standard here than there — accepting "time constraint" for one ticket's
unmet mutation gate and not the other — would not be a consistent gate.

## Blocked checks

None. Every other check in this pass ran to completion.

## Everything else this pass checked (complete inventory, not first-failure-stop)

- **Merge/lineage:** `d7ca665024` confirmed not an ancestor of `main`
  (`git merge-base --is-ancestor d7ca665024 main` — false at review time,
  before this bounce). Merged clean into the QA worktree (after fetching and
  merging `origin/main`'s one new commit, an unrelated BL-1077 approval).
- **required_wiring:** `specs/pipeline/steps/index.js:591` registers
  `bl1069TmuxServerVersionSteps` — confirmed by direct grep.
- **Shell/unit suite:** `bash swarmforge/scripts/test/test_bl1069_tmux_server_version.sh`
  — ALL TESTS PASSED (20/20), independently re-run.
- **Property suite:** `bb swarmforge/scripts/test/bl1069_tmux_version_property_runner.bb`
  — ALL 40 RUNS PASSED, healthy diversity across all no-server-client values
  (`3.4`/`3.6`/`3.7`/`3.7b`/`3.9`/`3.10`/`4.0` all drawn) — independently
  confirms the hardener's own generator-reseeding fix (third occurrence of
  the same defect class this session, after BL-991 and BL-1057) actually
  fixed the diversity problem, not merely re-measured it.
- **Acceptance:** `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1069-swarm-stamp-tmux-wsl-segfault-upgrade-hotfix.feature`
  — 12/12 (matches the hardener's own count; the architect's earlier 14/14
  predates the in-flight scenario-03 amendment that retired two rows
  BL-1075 made vacuous — expected, not a regression).
- **Code review against all 5 ticket-stated review goals** (independent read
  of `swarmforge.sh`, `install_tmux_wsl.sh`, `control_plane_lib.bb`, not
  taken on the coder's or architect's report):
  - Goal 1 (verdict reads the server, not the client): `warn_if_tmux_too_old`
    tries `tmux_server_version(socket)` first, falls back to the client only
    when no server answers, and names which it measured — confirmed at
    `swarmforge.sh:103-117`; the `ensure` branch resolves its own socket
    before calling it (`swarmforge.sh:180-183`), closing the exact blind
    spot the ticket names.
  - Goal 2 (preference never downgrades): `prefer_local_tmux_bin` compares
    `local_ver`/`path_ver` via `tmux_version_lt` and returns without
    prepending when local is empty or older — confirmed at
    `swarmforge.sh:78-96`.
  - Goal 3 (hardening stays soft): `harden_tmux_server` no-ops when
    `list-sessions` fails and wraps its `set-option` in `|| true` —
    confirmed at `swarmforge.sh:370-375`.
  - Goal 4 (`window-size largest` vs. the extension panel): BL-1075 already
    removed this knob entirely (own ticket, own parcel, in flight, not
    approved by this verdict) — confirmed absent from `harden_tmux_server`
    in this worktree; `focus-events off` (unaffected by the tiling
    contention) is the sole remaining knob.
  - Goal 5 (installer pinning/verification/arch-refusal): confirmed —
    `install_tmux_wsl.sh` resolves architecture against an explicit table
    (refusing an unlisted `uname -m`), verifies a sha256 digest before
    installing anything, and the `||`/`&&` precedence bug in the original
    landed guard is fixed with the mechanism explained in-file.
- **Live host verification (read-only, no live control-plane mutation —
  this ticket's `qa_e2e_procedure` steps 1/4/5 would bounce/restart the live
  swarm server this session is itself running under, so only the safe,
  read-only subset was exercised):**
  - `tmux -S <live socket> display-message -p '#{version}'` → `3.7b` — the
    fix is genuinely in effect on this real host, not merely in a fixture.
  - `dmesg | grep tmux.*segfault` → 3 matches, all at ~2400-3600s of a
    38853s uptime (system booted 2026-08-22 12:51:59) — all well before the
    hotfix landed and none since; no new segfault across the ~35000s since.
- **Docs:** `docs/how-to/BL-tmux-wsl-segfault-upgrade.md` describes the
  digest-verification requirement (`TMUX_INSTALL_SHA256=...`) matching the
  shipped installer exactly.
- **Babashka/shell tooling fallback correctly recorded:** hardener's
  evidence explicitly states no mutation/CRAP/DRY is wired for this lane and
  claims none.
- **Orphaned processes:** `pgrep -fl 'node --test\|stryker'` clean; the only
  `bb` processes running are long-lived daemons (handoffd, supervisors), not
  orphaned test runs.

## Remediation pointer

Owning role: **hardener**. Per the hardener's own recommendation in the
batch evidence file: pin each Example row's client/server literal against a
`KNOWN_EXAMPLE_VALUES`-style map in
`specs/pipeline/steps/bl1069TmuxServerVersionSteps.js` and assert the
captured value against it before the comparison runs, then re-run BL-113 on
scenario 1 until 29/29 kill (or individually, checkably justify any residual
survivor as equivalent — BL-234 style, matching how this same evidence file
correctly closed BL-1029's three survivors). Then forward down the
remaining chain (documenter → QA) so every gate after the fix runs again.

Note for the receiving role: BL-991 and BL-1075, riding the same batch
commit, are NOT part of this bounce — the hardener's own evidence records
both clean (all gates green), and neither has reached QA in this session
yet. This bounce concerns BL-1069 only.

## Bounce-hygiene note

`d7ca665024` is not an ancestor of `main` (verified above, prior to this
bounce's own commit). My QA-worktree merge of it was a plain merge with no
separate QA review-merge commit of my own to revert, and QA is terminal
(approve → `main`, or bounce → no `main` landing; per
`swarmforge/handoff-protocol.md` §"QA ancestor is bounce-aware", BL-952 —
`is_qa_ancestor.sh` unions plain ancestry with the recorded bounce verdict,
so a commit naming this bounce reads as refused regardless of reachability
from `swarmforge-QA`) — leaving my branch at this unapproved commit does not
misrepresent it as approved and contaminates no other ticket's lineage. No
further action taken on my branch.

— By QA.
