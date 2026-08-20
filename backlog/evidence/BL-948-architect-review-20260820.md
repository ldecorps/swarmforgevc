# BL-948 — architect review pass 1: complete inventory, PASS

- **Ticket**: BL-948 — socket-building acceptance fixtures overrun the 100-char path guard (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `9159fbc1c8` (cleaner batch: BL-948/962/963/964/965)
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## The defect and the fix, both reproduced

| | root | worst-case socket | vs 100-char guard |
|---|---|---|---|
| **Old** `os.tmpdir()` shape | `/private/var/folders/…/T/bl368-control-loss-xfm19U` (82) | **115** | **15 OVER** — scenario dies on the refusal |
| **New** `mkSocketFixtureRoot` | `/private/tmp/bl368-control-loss-S0oXzG` (38) | **71** | 29 chars of headroom |

`mkSocketFixtureRoot` calls `realpathSync` **before** measuring, so the length
check sees the resolved `/private/…` form rather than the shorter unresolved one.
That detail matters: it is exactly the distinction that makes this class of failure
so easy to misattribute (`/var/…` vs `/private/var/…` differ by 8 chars, and the
observed real-world margin was 2).

**The ticket's own reported symptom is closed.** BL-368's
*"A role whose process is still alive is never relaunched"* — which previously
never reached the still-alive check because `unpark` refused on path length —
now passes; the whole BL-368 feature is **4/4**.

## Declared-invariant pass (BL-633/BL-654)

**Invariant 1** — *the gate defines the adoption set by inspection at gate time,
never a checked-in roster.* Satisfied and **non-vacuous, proven by me**: I planted
a step file that builds a socket path under `os.tmpdir()`, and
`socketFixtureShortRootGuard.test.js` failed naming it; removing it returned the
suite to green (5/5). Scope is decided by two regexes over each file's own text —
in scope iff it references a control socket **and** roots a fixture at the long
base — so a new step file is covered the day it is written.

Worth recording: this gate **keeps string literals** and strips only full-line
comments, with a comment explaining that socket paths live precisely in strings.
That is the exact correction I prescribed for BL-962's invariant-2 gate, which
strips string contents and therefore cannot fire. Same author, opposite outcome —
the distinction was applied deliberately here.

**Invariant 2** — *a fixture root is removed in a `finally`, not after the last
assertion.* Verified by A/B rather than by reading:

| Scenario | Result |
|---|---|
| Helper root, scenario throws before its own cleanup | root **gone** — reaped by the exit hook ✓ |
| Old `mkdtempSync(os.tmpdir())`, same throw | root **leaked** on disk (the behaviour the invariant forbids) |

The helper tracks every root it hands out and reaps on `process.on('exit')`,
calling `fixtureReaper.reap` by socket path first so a fixture tmux server dies
with it. `bl948SocketFixtureInvariants.property.test.js` covers clean exit, throw,
**and** nonzero exit — 3/3.

## Everything else — run and PASSED

| Check | Result |
|---|---|
| Adoption breadth | **51 step files** converted to `mkSocketFixtureRoot`; the gate reports **0 remaining violations** across `specs/pipeline/steps`. The parcel did the conversion, not just the helper. |
| BL-948 acceptance 01–05 | **5/5 pass** |
| `socketFixtureShortRootGuard.test.js` | 5/5 — includes its own smoke case, a no-socket-fixture negative, and a "prose about sockets in comments never pulls a file into scope" case |
| `bl948SocketGuardLimitParity.test.js` (BL-897 mirrored constant) | PASS, and **non-vacuous**: drifting `SOCKET_PATH_GUARD_LIMIT` 100 → 120 fails with *"has drifted from swarm_socket_lib.bb's max-safe-socket-path-len (100). The .bb value is the one the swarm actually enforces"* — names the source of truth, not just the mismatch. Restored. |
| Dependency-rule gate (BL-259, hard gate) | **RUN, exit 0, clean** — the two new lib modules pull in no part of the pre-existing `telegram*` cycle. |
| Co-change (BL-255) | RUN, informational — the helper co-changes with its two gates and the adopting step files, exactly as expected for a newly introduced shared module. |
| Guard not relaxed | Confirmed — `swarm_socket_lib.bb`'s 100-char fail-closed bound is untouched; only the fixtures moved. This was the right call: the guard exists because of the 104/108 `sun_path` limits. |
| `/tmp` as the short base | Correct here despite the workflow rule about agent scratch files. That rule governs an agent's own temporary files; this is a test fixture base, and the short path is the point. On macOS `/tmp` → `/private/tmp` (13 chars), leaving ample headroom. |
| Architecture | One shared helper plus one shared guard module, both required by the standing suite gate, the property lane, and the acceptance steps — the rules have a single implementation rather than three restatements of the same regexes. |

No check was blocked.
