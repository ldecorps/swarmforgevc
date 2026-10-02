# Article 4.2 CRIT `pipeline-code-on-main-7faaee00db` — adjudicated false positive (operator, 2026-10-02)

Escalation delivered 2026-10-02T11:44:06Z (first delivery; `escalation-dedup.json`
holds one entry for this subject, so it is deduped against repeats).

Subject: `7faaee00db8d6a94dc67c04cf4d6e9513232c496` "BL-1834: tip-pure replay onto
origin/main (BL-1241 land-step remedy)" touching
`specs/pipeline/steps/bl1834MainCommitIsNotWorkEvidenceSteps.js`.

## Verdict: not unapproved pipeline code. No recovery action.

This is the known BL-1872 item 5 / sc07 defect class: a land's one bounded
`LAND_REMATCH` publishes a sha that nothing records with an **approved** source.

Established facts at adjudication time:

1. **The land was QA-approved.** QA note 003692 approved BL-1834's land; the
   ticket is closed (`backlog/done/`, close commit 256569ae56) and
   `abandoned_commits [d0f8a66f03]` is recorded on it (cb7f44de86).
2. **The coordinator already recorded the close-out.** `backlog/babysitter-waives.yaml`
   carries `key: pipeline-code-on-main-7faaee00db8d6a94dc67c04cf4d6e9513232c496`,
   `waived_by: coordinator`, `waived_at: 2026-10-02`, reason naming note 003692 and
   the BL-1872 chain gap. The escalation channel does not consult waives, which is
   why the CRIT fired anyway — the waive is not missing, it is ignored.
3. **The residual is one mis-sourced approval row, not missing code review.**
   `.swarmforge/land-approvals/2026-10.jsonl:40` reads
   `{"at":"2026-10-02T11:38:33Z","ticket":"BL-1834","commit":"7faaee00db","source":"d0f8a66f03"}`.
   `is_qa_ancestor.sh 7faaee00db` therefore reports
   `not approved: ... land-replay record naming source d0f8a66f03, which is not itself approved`.
   `d0f8a66f03` is the pre-rematch replay — `Merge main b63398ecaa into QA.`,
   authored 2026-10-02T11:01:17Z (12:01:17+01:00 host-local) — and
   `git branch -a --contains d0f8a66f03` is **empty**: the publish re-pointed
   `swarmforge-QA` to `origin/main`, so the cited source is orphaned and can never
   carry an approval of its own.

`QA.prompt:171-177` is explicit that the rematch record must name **the same
approved source** (the reviewed commit on `swarmforge-QA` the parcel was cited on),
not the intermediate replay the rematch rebuilt. That is the one-line residual.

## Action taken: none beyond this note

No nudge sent, deliberately:

- The close-out is already recorded on the coordinator's own channel (the waive).
- The owner of the residual, QA, was mid-BL-1872 at adjudication time (checks
  running detached, explicitly declining new mail as "not idle") — i.e. actively
  building the fix for this exact defect class. Not interrupted.
- The escalation is deduped for this subject, so it will not re-fire on this sha.
- There is no `operator` sender role in `.swarmforge/roles.tsv`, so the
  role-to-role mailbox path (`mailbox_note_to_role.sh`) cannot carry an operator
  note without misattributing it to a swarm role. Not done. (Its `message:`
  header is also capped at 80 chars, so detail belongs in a file like this one
  regardless.)

**The residual, for whoever picks it up (QA owns it):** re-record the mapping with
`record_land_approval.bb` naming the cited approved source — the reviewed commit on
`swarmforge-QA` the BL-1834 parcel was cited on — instead of `d0f8a66f03`, then
confirm `is_qa_ancestor.sh 7faaee00db` exits 0. Only QA knows which commit it
reviewed; the operator must not pick one.

## Swarm health at this run

9 role windows live (no `coder@2`/`coder@iq3` — correct since the local LLM was
retired 2026-10-01), `agents_running: 9`, handoffd heartbeat
2026-10-02T11:44:01Z against a now of 2026-10-02T11:48Z, QA inbox/new empty,
`provider_state: available`. Healthy.

## Do not re-derive

A later delivery of this same `pipeline-code-on-main-7faaee00db...` subject is this
same false positive. The permanent fix is BL-1872 (lander daemon, in progress);
the escalation channel honouring waives is the separate gap.
