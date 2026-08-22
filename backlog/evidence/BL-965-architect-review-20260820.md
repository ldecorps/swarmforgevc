# BL-965 — architect review pass 1: complete inventory, PASS

- **Ticket**: BL-965 — the heal wrapper leaks its mktemp capture file when killed (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `8bfecb4ae0` (cleaner) — coder `a974fefcf`
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## The design decision is the interesting part, and it is right

The obvious fix — one combined `trap 'rm -f "$f"' EXIT INT TERM HUP` — is
**wrong here**, and the parcel deliberately avoids it. A bare rm-only trap
**consumes** the signal: bash would resume past the interrupted foreground child
and `cat` a file the trap had just removed, changing a killed run's output and
leaving the wrapper alive after a `respawn-pane -k`. The parcel instead gives
`EXIT` sole ownership of the `rm` and makes each signal trap re-exit with the
conventional `128+N`:

```
trap 'rm -f "$__sfh_out_file"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
```

## Declared-invariant pass — both verified empirically on the REAL composed wrapper

I generated the actual wrapper via `build-healing-wrapper-command` and signalled
it as a **process group** (bash defers traps while a foreground child runs; macOS
ships no `setsid`, so `perl setpgrp`).

| Experiment | Result |
|---|---|
| **Invariant 1**, TERM to the process group | exit **143** (the conventional 128+15) and **no `sfh.*` leak** — 13 files before, 13 after ✓ |
| **Non-vacuity** — same wrapper with the `trap` lines stripped (the pre-BL-965 shape) | **LEAKED**: 13 → 14. The defect reproduces exactly, and the traps are what prevent it ✓ |
| **Invariant 1, second half** — SIGKILL | residue as expected (uncatchable), and it keeps the recognizable name: `sfh.mGOetr` ✓ |
| Stock `/bin/bash` 3.2.57 parse of the composed wrapper | `bash -n` clean — the trap syntax is 3.2-safe as claimed ✓ |

**Invariant 2** — *adding cleanup changes nothing else observable.* The risk is
real: four new lines enter the composed wrapper, which BL-960's parse gate and
byte-fidelity invariants constrain. Re-ran BL-960's own corpus rather than trusting
the claim:

| Suite | Result |
|---|---|
| BL-960 acceptance (parse gate, byte-exact round-trip) | **10/10** |
| BL-913 acceptance (pinned shell, one classified retry) | **6/6** |
| BL-934 acceptance (must not look like `rm` of the worktree) | **3/3** |
| `tool_miss_heal_lib_test_runner.bb` | ALL TESTS PASS |
| `tool_miss_heal_lib_property_runner.bb` | ALL PROPERTIES HOLD |

## Everything else

| Check | Result |
|---|---|
| `depends_on: [BL-960]` satisfied | YES — BL-960 is in `backlog/done/M8/` on both `main` and `origin/main`. |
| BL-965 property runner | ALL PROPERTIES HOLD — 15 draws over the real composed wrapper; coverage `{:normal 4, :int 1, :term 2, :hup 4, :kill 4}`, including the SIGKILL residue-pattern arm. |
| BL-965 acceptance 01–04 | **4/4 pass** (signal outline + byte-identical normal completion) |
| Dependency-rule gate (BL-259, hard gate) | **RUN, exit 0, clean** |
| Tail `rm` retained | Correct — idempotent with the EXIT trap, and removing it would have been a gratuitous behaviour change under invariant 2. |
| Architecture | Composition-only change inside `build-healing-wrapper-command`; no new module, no new seam, the hook's own contract untouched. |

## Observation — the leak's physical residue is on this host

`${TMPDIR}` currently holds **13** `sfh.*` files dating from **Aug 19 21:11**,
i.e. before this fix. They are the leak this ticket describes, already on disk.
I left them alone — they are not mine to delete — and I removed only the two my
own signal experiments created. Worth noting for the documenter/QA: the fix stops
new residue but does not sweep the existing files, which matches the ticket's scope
(the `sfh.*` naming is precisely what makes them identifiable to an external
cleanup later).
