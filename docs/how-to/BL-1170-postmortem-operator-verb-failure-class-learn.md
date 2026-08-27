# /postmortem operator verb — disaster learn loop (BL-1170)

*How-to. Epic BL-1168 slice — after recovery, qualify outage cause and teach
babysitter + operator playbook. Sibling to BL-1171 correlation.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Operator verb | `telegramCursorOperatorExec.ts` | `/postmortem` (soft confirm tier, BL-698 surface) |
| Learn logic | `extension/src/tools/operatorPostmortem.ts` | Qualify incident, update registries, mint intake stub |
| Incident source | BL-958 disaster incident record | Cleared incidents within lookback |
| Registry | `.swarmforge/babysitter/failure-classes.json` | Gitignored — babysitter recognition |
| Playbook | `.swarmforge/operator/failure-class-playbooks.json` | Suggested actions with owners |
| Intake stub | `backlog/INTAKE-disaster-*.md` | Never auto-mints BL tickets (BL-311) |

One postmortem pass per failure-class incident window — idempotent.

## Operator flow

After a cleared disaster incident (starvation cascade, handoffd parse-dead, etc.):

```text
/postmortem
```

On success: qualified record under `.swarmforge/operator/postmortem-records/`,
updated failure-class registry and playbook, and an `INTAKE-disaster-*` stub.

Refuses with **nothing to postmortem** when no recent cleared incident exists.

Unrecoverable parse-error class: playbook marks **human hotfix required**;
registry still records the class for BL-1171 recognition.

## Verify

```bash
cd extension && npm test -- operatorPostmortem
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1170-postmortem-operator-verb-failure-class-learn.feature
```

Related: [BL-1171 disaster-class escalation](BL-1171-disaster-class-correlation-structured-escalation.md);
[BL-698 operator commands](BL-698-telegram-cursor-operator-commands.md).
