# Babysitter Article 4.2 — the merge-commit sub-cause BL-962's exemption cannot clear

Date: 2026-09-03 (Operator, health sweep). Babysitter escalated three
pipeline-code-on-main findings:

- `c2cd0ca698` "Merge morning briefing for 2026-09-03 (documenter, BL-658 ceremony)"
- `e3ce579112` "Merge-up: BL-1344 QA-approved, merge branch up to QA's"
- `15dc336877` "Merge-up: BL-1346 QA-approved, merge branch up to QA's"

All three are **false positives**. No pipeline code bypassed QA. Recorded so
this is not re-derived a sixth time — see also
`coordinator-babysitter-article42-false-positive-20260902.md`, which covers a
DIFFERENT sub-cause (replay commits carrying no "By QA." trailer) and is
already routed to the specifier (@71f7723848).

## Verification (content, not subjects)

- Flagged paths: `extension/test/activePoolFreshnessAudit.test.js`,
  `extension/test/bl1300HeadroomProofIsPinned.test.js`,
  `extension/test/docsStructureRealTree.test.js`,
  `specs/pipeline/steps/index.js`, plus BL-1344's waive step/fixture files.
- `swarmforge-QA` and `main` hold **byte-identical blobs** for those paths
  (`specs/pipeline/steps/index.js` = `99d98d075a` on both;
  `activePoolFreshnessAudit.test.js` = `1df7dd635c` on both).
- The content was introduced by `450753c10a` (specifier-accepted BL-1066
  `rule_proposal` correction, comment-only) and `edc15b400c` (BL-1344), both
  now ancestors of `swarmforge-QA`.
- `e3ce579112` and `15dc336877` are themselves ancestors of `swarmforge-QA`
  as of this sweep; `c2cd0ca698`'s non-first parent `291c52c441` is too.
  `is_qa_ancestor.sh` returns 0 (approved) for every non-first parent, and
  no bounce record names any of them.
- `main == origin/main` at `aee7842214`; a live re-run of
  `check_pipeline_code_on_main.sh` is clean.

## Root cause — a SECOND, structural gap in BL-962's merge adjudication

`adjudicate-merge-paths` (babysitter_check.bb) exempts a merge's path only
when some non-first parent is BOTH QA-approved AND holds content
**byte-identical to the merge result** for that path.

A genuine two-sided merge cannot satisfy that. When both parents edited the
same QA-exclusive path, the merge result is their **union** and is therefore
byte-identical to *neither* parent, so the exemption can never fire:

```
git diff --quiet f1e6a3fd92 e3ce579112 -- specs/pipeline/steps/index.js  -> DIFFERENT
```

and the whole difference is merge-resolution reordering of `require(...)`
lines in the `DOMAINS` registry (plus one line the other side added):

```
-  require('./bl1335ExhaustionOpensFailoverRecordSteps');
   require('./bl1352EscalationTransportFaultSteps');
+  require('./bl1335ExhaustionOpensFailoverRecordSteps');
```

`specs/pipeline/steps/index.js` is the shared registry **every** ticket
appends to, so any merge-up where `main` also touched it CRITs
unconditionally. This is not the back-merge-lag timing blind spot already on
file; it does not self-clear with time, and it will recur on essentially
every merge-up.

Note the exemption's byte-identity rule is deliberate (BL-925's posture: a
writer must not ride fresh pipeline edits in on a legitimate merge's
coat-tails), so the remedy is a design question for the specifier, not a
loosening the Operator may make. A per-path three-way comparison against the
merge base — "the merge introduced nothing this path did not already carry on
one of its parents" — is the shape that would distinguish a union merge from
a smuggled edit, but that is the specifier's call.

## Disposition

No action taken: no revert (would drop QA-approved content from the
coordinator's live worktree), no waive recorded (the findings are already out
of the sweep window now that `main == origin/main`, so a durable waive would
outlive the finding), no ticket minted (the Article 4.2 gate-accuracy gap is
already routed to the specifier; this note refines its root cause), no nudge.
Swarm health GREEN at the time of writing: 8/8 role panes live, handoffd
heartbeat 0s fresh, HEAD advancing, pipeline board in sync.
