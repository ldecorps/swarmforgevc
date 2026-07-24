# BL-613 architect SEND BACK #2 — 2026-07-24

Bounced commit: `5406e34f49` (cleaner, "fix documentation to match 60-second
hardcoded threshold"). Routed back to **coder**.

## Verdict

**Architecture: CLEAN.** Dependency-rule gate passes full-repo
(`node extension/out/tools/dependency-gate.js` → "PASSED: no forbidden edges").
Co-change report shows no pair at or above the default threshold. No layer,
storage, secret, or spawn violation. The parcel touches docs + one test fixture
comment only.

**Correctness: SEND BACK.** The QA bounce (`BL-613-bounce-20260724.md`) was one
instance of a general defect: `docs/how-to/BL-349-stuck-role-escalation-email.md`
describes an alarm that does not match the shipped code. The cleaner fixed only
the one instance QA named (90s → 60s, and the phantom
`stuck_escalation_threshold_seconds` conf key). **Three more fabrications of the
identical class remain in the same file**, all verified against the code below.
QA will bounce this again on the same grounds.

Per architect.prompt ("a correctness defect you can SEE is a send-back") and
BL-333, the parcel is held rather than forwarded with a rule_proposal.

## The three remaining defects

### 1. Email subject line is wrong (doc line 11)

Doc claims the human will receive:

```
SwarmForge: role <ROLE> stuck, needs intervention
```

Actual, `swarmforge/scripts/stuck_escalation_email_lib.bb:144`:

```clojure
((:send-email! adapters) (str "SwarmForge: " role " is stuck and needs attention") ...)
```

→ real subject: `SwarmForge: coder is stuck and needs attention`

Neither the word order, the `role ` prefix, nor the trailing clause matches. A
human who sets an inbox filter or searches on the documented subject during an
incident matches nothing — the precise failure the runbook exists to prevent.

### 2. The "email contains" list and example body are fabricated (doc lines 14–27)

Doc promises the email carries the ticket id, a path to the escalation log, and
a recommended recovery command, and shows this example:

```
The coder role has not responded for 60 seconds while working on BL-528.
No progress has been detected.

Escalation log: /path/to/target/.swarmforge/daemon/chase-escalations.json
Recommended action: respawn the coder role via swarmforge ensure /path/to/target
```

Actual, `stuck_escalation_email_lib.bb:111-117` (`email-text`, which takes
`[role]` and nothing else):

```
The role "coder" has been stuck (holding an in-process task with no forward progress) past its escalation threshold.

This is unattended - nobody has been notified until this email. Check the role's pane/log and, if needed, respawn or intervene by hand.

This clears on its own once the role becomes unstuck; a NEW stuck episode after recovery will email again.
```

The real body has **no ticket id, no escalation-log path, no elapsed-seconds
figure, and no recommended command**. `email-text`'s only argument is `role`, so
it structurally cannot carry a ticket id. Doc lines 16, 17, 18 and the whole
example block are false.

### 3. "Escalation Log Contents" is entirely fabricated (doc lines 57–82)

Doc shows `.swarmforge/daemon/chase-escalations.json` as a record array:

```json
{ "escalations": [ { "role": "...", "escalated_at": "...", "idle_seconds": 92,
                     "ticket_id": "...", "status": "...", "reason": "..." } ] }
```

Actual writer, `swarmforge/scripts/chase_sweep_lib.bb:600-603`:

```clojure
(defn write-escalation! [daemon-dir role escalated?]
  (let [current (read-escalations daemon-dir)
        updated (if escalated? (assoc current (keyword role) true) (dissoc current (keyword role)))]
    (spit (escalations-path daemon-dir) (json/generate-string updated))))
```

The file is a **flat role→true map**: `{"coder":true}`, or `{}` when nothing is
escalated. Verified on disk — every live `chase-escalations.json` on this host
reads `{}`. This parcel's own wiring test asserts the flat shape
(`test_handoffd_stuck_escalation_email_wiring.sh:130`,
`grep -q '"coder"' .../chase-escalations.json`).

None of `escalated_at`, `idle_seconds`, `ticket_id`, `status`, or `reason` is
ever written by any code path. Doc lines 76–82 explain six fields that do not
exist, including the claim that `status: "email-sent"` confirms delivery — the
delivery-arming state actually lives in a **different** file,
`chase-escalation-email-state.json` (`stuck_escalation_email_lib.bb:41`), which
the runbook never mentions.

## Also worth fixing while the file is open (lower confidence, pre-existing pattern)

Recovery Steps cite `swarmforge ensure /path/to/target` (doc lines 26, 101) and
`swarmforge kill /path/to/target` (line 117). There is no `swarmforge` CLI in
this repo or on PATH; the real entry points are `./swarm`, `./swarm-kill`,
`swarmforge/scripts/swarm_ensure.bb`, and
`swarmforge/scripts/kill_all_swarm.sh`. This same wording already exists on main
in `docs/how-to/BL-144-daemon-death-alarm.md`, so it is a pre-existing repo
convention rather than something this parcel invented — flagged, not the reason
for the bounce. If the intent is a conceptual command name, say so; if not, use
the real ones.

## What "fixed" looks like

Every factual claim in this runbook is checked against the code it describes —
subject string, body text, log file name, log file shape, field names, and
recovery commands — not just the two the QA bounce happened to name. The
threshold fix already made (60s, hardcoded at `handoffd.bb:46`) is correct and
verified; keep it.

## Note for the re-merge

This send-back reverts merge `29b768d39` out of `swarmforge-architect` per
BL-490/BL-495, so the un-approved content is no longer in this branch's tree.
Git ancestry of `5406e34f49` is unavoidably retained (a revert does not rewrite
history). When the reworked parcel returns, **revert this revert first**
(`git revert <revert-sha>`) before merging, or git will treat the reverted
content as already-merged and silently drop it.
