# BL-1191 restart gate — twelfth reading, and the hold is DISCHARGED

**Reader:** specifier, 2026-08-29 (~01:55Z)
**Source gate:** `.swarmforge/operator/INTAKE-bl1191-pilot-cleanup-gate-before-restart.md`
(human directive, 2026-08-27 ~16:39 BST: *"BL-1191 is being piloted through. When
it's done, before restarting the swarm, triple-check that it cleaned after itself.
Earlier today a pilot left a mess (did not land its code on main, for instance)."*)

The gate's own exit condition is **"do not start-swarm until that check reports
green, or the human overrides."** All three checklist items now report green
against `origin/main` and disk. This reading records the evidence, discharges the
hold, and carries forward the residuals so archiving the intake loses nothing.

---

## Check 1 — durable land on `origin/main`: **PASS**

Fetched before reading. `git rev-list --left-right --count main...origin/main` → `18 0`
(local ahead only, nothing behind).

| Required on the tip | Verdict |
|---|---|
| `swarmforge/scripts/wake_dedup_lib.bb` exists on `origin/main` | present |
| `swarmforge/scripts/handoffd.bb` consults the wake-dedup gate | present — `wake-dedup-lib/load-decision` (1008), `wake-dedup-skip` log (1010), `wake-dedup-lib/record-injection!` (1016), `load-file` of the lib (51) |
| extension chaser path shares the dedup sidecar | present — `withHandoffWakeDedupCallbacks` ×2 in `extension/src/watchdog/chaserMonitor.ts` |
| `specs/pipeline/steps/index.js` registers `bl1191HandoffWakeFollowUpDedupSteps` | present |
| Ticket YAML in `done/` | `backlog/done/M8/BL-1191-handoff-wake-follow-up-dedup.yaml`, on `origin/main`, moved by `8f587df0f` — *"Close BL-1191: move to done (pilot acceptance gate green)"* — the pilot-acceptance-gate, not a bare `git mv` |
| Local `main` not secretly holding the only copy | `git diff --name-only origin/main..main` over `extension/src/` + `swarmforge/scripts/` is **empty**. Twelfth consecutive clean reading on this item. |

**Two corrections to the checklist as written, neither a miss by the pilot:**

- The checklist named `extension/src/swarm/verifiedInject.ts` as the
  sidecar-sharing site. The ticket's own `required_wiring:` names
  `extension/src/watchdog/chaserMonitor.ts::withHandoffWakeDedupCallbacks`.
  The gate file was written before the build and guessed the file; the item is
  satisfied at the site the ticket actually declares. `verifiedInject.ts` carries
  the wake *message* constant, not the dedup sidecar.
- The checklist required `status: done` inside the YAML. **Every** ticket in
  `backlog/done/M8/` carries `status: todo` or `status: paused` — the folder is
  the status in this repo. Not a pilot defect.

## Check 2 — this expedition's leftovers: **PASS**

- `.worktrees/expedite-BL-1191` — gone; no worktree registered for it.
- `expedite/BL-1191` — the branch ref still exists, but with no worktree there is
  nothing dirty on it. The checklist requires only that it not be *"left dirty
  with uncommitted product code"*.
- No `/tmp/bl1191*` leftovers.
- The untracked `wake_dedup_lib.bb` the gate file flagged at 2026-08-27 gate time
  is **committed and landed on `origin/main`**, not abandoned on disk. This was
  the single sharpest item on the original list and it is clean.

## Check 3 — host checkout hygiene: **PASS, with the parking named**

- No BL-1191 product files dirty in the `main` working tree.
- `.swarmforge/operator/control-pause.json` → `{"active":false}`.
- Parked siblings, named as the checklist requires: the BL-1248 expedite parked
  six tickets into `backlog/hold/` and **those moves are still staged but
  uncommitted in the shared master index** — BL-1233, BL-1234, BL-1242, BL-1244,
  BL-1247, BL-1249. `hold/` is human-held (Article 3.1), so unparking is the
  human's; the *uncommitted* state of the moves is the part that is fragile.

---

## New finding this reading — minted as **BL-1255** (defect / high)

Running check 1 against BL-1191's declaration turned up a gap in the gate that
was supposed to catch exactly this class.

BL-1191 landed declaring:

    swarmforge/scripts/handoffd.bb::wake-dedup-gate::daemon notify path
    consults last fingerprint before inject

The literal `wake-dedup-gate` appears **nowhere** in `handoffd.bb`. The matcher
is a plain substring test, so that entry could never match — the BL-874 class —
and **nothing refused it**.

The reason nothing refused it: `pre_qa_gate_lib.bb` is reached from exactly one
place, `swarm_handoff.bb` (line 14), applied to a `git_handoff` addressed to QA.
The expeditor sends no handoff mail, so `expedite.sh` / `expedite_cli.bb` /
`expedite_lib.bb` evaluate `required_wiring:` nowhere at all. *"Same gates, no
machinery"* (BL-567) is not true of this gate.

BL-1191's behaviour did land correctly, under a different name — so this miss
cost nothing. **That is the finding.** Nothing about the run distinguished a
correct land from a mechanism wired into nothing (the BL-419 shape). It was
caught only because a human had standing orders to check a pilot by hand, which
is the very dependency the gate was meant to remove.

Minted per the intake's own authorisation (*"Optional specifier follow-on (not
this hold): if 'pilot claimed done but did not land on origin/main' is still an
unowned process gap after BL-727/BL-701, mint a separate defect"*). BL-727 closed
the neighbouring acceptance-pointer half; this is the `required_wiring` half.

---

## Residuals that OUTLIVE this gate

Discharging the hold does not settle these. Carried here so archiving the intake
loses nothing:

1. **BL-1192 is in `backlog/paused/` while its work is landed and QA-approved**
   (`27eadb5dad` is an ancestor of `main`). Shipped work parked where the
   coordinator can promote and rebuild it. Named in the tenth and eleventh
   readings; still unremedied. Coordinator bookkeeping — a note has been sent.
2. **Six `active/`→`hold/` moves staged but uncommitted** in the shared master
   index (list under check 3). Unparking is the human's; committing the moves is
   the coordinator's.
3. **BL-1249 and BL-1250 are unbuilt** and BL-1249 is itself parked in `hold/` —
   the expeditor still restarts without consulting any hold marker, and its
   restart verdict still cries wolf.

## Discharged since the eleventh reading

- **BL-1236 landed** (`backlog/done/`) — the reconcile predicate behind thirteen
  realised resets.
- **BL-1248 landed** (`backlog/done/M8/`) — the kill switch.
- **All six erased approvals re-recorded**: BL-1224, BL-1225, BL-1226, BL-1244,
  BL-1245, BL-1246 all read `human_approval: approved` again.
- **The swarm is up and healthy**: 8 distinct role agents, `handoffd.bb` and
  `handoffd_supervisor.bb` both live.

---

## Verdict

**HOLD DISCHARGED.** All three checklist items green; the swarm the gate was
protecting is already running and healthy; the reset cause and its stopgap have
both landed. The gate can no longer gate anything, and its stated exit condition
is met. `INTAKE-bl1191-pilot-cleanup-gate-before-restart.md` moves to
`.swarmforge/operator/archive/`.

By specifier.
