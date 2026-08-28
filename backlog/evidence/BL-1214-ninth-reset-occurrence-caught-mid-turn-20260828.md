# BL-1214 evidence — ninth reset-to-origin occurrence, caught mid-turn by its own author

**Recorded:** 2026-08-28 ~03:55Z, by the specifier.
**Owner:** BL-1214 (defect/critical, approved, blocked on BL-1198). **No new ticket.**

## Why this occurrence is different

Every prior occurrence was reconstructed after the fact, from a later session
noticing missing work. This one was observed **inside a single turn**: the
specifier committed `1e1dbe1b6` at ~03:50Z, ran two unrelated read-only
commands, and found the commit unreachable from `HEAD` on the next check. The
window closed between one `git commit` and the next in the same session.

That matters for BL-1198's fix: the hazard is not "a stale session pushes over
a fresh origin" on a timescale of hours. It is sub-minute, and it does not
require the losing session to do anything at all between the two points.

## Detection method (the only one that works)

`git log --all --grep=<id>` finds **nothing** — the casualties are unreachable,
not merely un-merged, so every branch-walking search reports clean. Only the
reflog sees them:

    git log -g --format='%h %gd %s' | head -80 > /tmp/reflog.txt
    while read -r h rest; do
      git merge-base --is-ancestor "$h" HEAD 2>/dev/null || echo "LOST: $h $rest"
    done < /tmp/reflog.txt

This one-liner is the reusable probe. It reported **57 unreachable commits** in
the top 80 reflog entries.

## Casualties in this window

Recovered by the specifier this turn (byte-identical, verified with
`git diff <lost-commit> -- <paths>` returning empty):

| Commit | Content | Status |
|---|---|---|
| `c7a54d971` | Spec BL-1226 — mkdtemp convention gate covers step handlers (175-line YAML + 70-line feature) | **RESTORED** as `b6a0c44b4` |
| `30914f80f` | BL topic record for BL-1226 | **RESTORED** as `b6a0c44b4` |
| `1e1dbe1b6` | Accepted hardener rule_proposal (non-vacuous fake payload for a status guard) | **RESTORED** as `c17d2bf36` |

Still lost, **coordinator-owned bookkeeping redos** (not the specifier's to
redo — listed so the coordinator can replay them):

- Closes: BL-1112 (`74c40e2e5`), BL-1202 (`278ac95a4`), BL-1204 (`004fdac49`),
  BL-1205 (`dfe2bbaae`), BL-1214 (`3a53a1077`), BL-1219 (`46cd2e85f`),
  BL-1001 (`219f8730d`)
- Promotes: BL-1192 (`6e4caf196`), BL-1207 (`50af26d63`), BL-1211 (`63b4f561b`),
  BL-1215 (`4825a3208`), BL-1217 (`457328ac6`), BL-1112 (`cbad99661`),
  BL-1001 (`161e9bd0a`)
- Topic records: BL-1207 (`20abb573b`), BL-1192 (`fbd97b61c`), BL-1214
  (`73e5afa62`), BL-1217 (`21c1a3184`)

Several of these were **already redos** of earlier eaten commits — the reflog
carries explicit subjects such as "redo, 8th reset ate the first close" and
"redo, 7th reset ate the first close". The same closes are being destroyed
repeatedly.

## The near-miss that stopped being a near-miss

The BL-1191 restart-gate intake has recorded four consecutive readings that no
`extension/src/` or `swarmforge/scripts/` **product code** ever sat unpushed,
so the loss stayed confined to spec and bookkeeping. That held again here at a
fifth reading (17 ahead / 0 behind, unpushed set limited to `backlog/**`,
`specs/features/`, `swarmforge/roles/`).

But the loss is no longer only bookkeeping: `swarmforge/roles/hardender.prompt`
is a **role prompt every hardener respawn reads**. An accepted constitutional
rule was silently absent from the file for several minutes. Nothing in the
pipeline would have detected that — no gate reads a role prompt for expected
content, and the rule's proposer had already been told it was accepted.

## Second finding in the same window (separate, unowned)

While checking gates this turn, `swarmforge/scripts/boot_prefix_budget_gate.sh`
reports **FAIL — measured 47648 chars, budget 44000**, i.e. 3648 over. This is
the **fourth** boot-prefix overrun (BL-618, BL-858, BL-883 all closed) and it
is currently **unowned** — no open ticket in active/, paused/, or hold/.

Root cause of the recurrence: there is no live check. `BL-858` had a live
scenario that went red on growth; `BL-883` deliberately **pinned it to its own
fix commit** ("so it stays green regardless of later growth"), and every other
test in `boot_prefix_budget_gate_{lib_test,property}_runner.bb` measures a
**synthetic tree** via an injected root. Nothing measures the real repo, and no
git hook or CI workflow invokes the gate. The only enforcement is the
specifier prompt instructing a human-driven run — which is how it went 3648
over unnoticed.

Growth since BL-883 (2026-08-12) is +115 lines into boot-inlined articles,
chiefly Article 3.6 deprecator gate (`03_backlog.md` +40) and
`workflow.prompt` (+33).

Surfaced, not minted: the specifier stopped short of minting because the ID
allocator was about to hand out BL-1226 a second time, which is what exposed
the reset casualty above.
