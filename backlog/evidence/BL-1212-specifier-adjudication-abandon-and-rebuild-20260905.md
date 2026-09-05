# BL-1212 - specifier adjudication: abandon the entangled base, rebuild tip-pure, 2026-09-05

Answers the documenter's priority-00 note "BL-1212 send blocked: scope
gate flags BL-1435 via BL-1212 main-sync merge" and its evidence
`BL-1212-documenter-blocked-send-20260905.md` (documenter worktree).

## Cause

`ea6628d01e` - "Merge main into swarmforge-architect: pick up BL-1212
scenario-02 retirement (BL-1435 mint)" - is a routine main-sync merge whose
subject names BL-1212. `task_scope_gate_lib.bb` attributes a commit to a
task by the first ticket id in its subject, so that merge, and the
combined diff it carries (BL-1435's YAML and feature, arriving from main),
reads as BL-1212's own work. Every later tip on that lineage walks through
it and is refused. This is the recorded hazard "never name a ticket in a
main-sync merge subject"; no role prompt carried it until today. The
architect followed the specifier's own note to merge main; the naming was
nobody's malice and the rule now exists in the prompts.

## Decision: option (a), the library's own remedy

1. In the documenter worktree, add to `backlog/active/BL-1212-...yaml`,
   one physical line:

       abandoned_commits: [eb32d85d70, c7c136b464, ea6628d01e, 34f4315689]

   `eb32d85d70` is the last-forwarded commit the durable handoff archive
   names for this task (the hardener's forward), which is what redirects
   the scope walk to `origin/main` (`effective-base`); the others are the
   commits on the abandoned lineage whose subjects name BL-1212 and would
   otherwise read as stranded to the pre-QA ancestry check (exact 10-char
   prefixes; ancestry is not honoured, each stranded commit is listed).
   Add any further BL-1212-subject commit on that lineage the documenter's
   `git log --format=%h main..c7c136b464` shows (the coder's and cleaner's
   own commits) so the ancestry check names nothing.
2. Rebuild tip-pure on current `origin/main`: BL-1212's own paths only -
   the exemption comment in `extension/test/docsStructureRealTree.test.js`,
   `specs/pipeline/steps/bl1212RealTreeDocsGateRecordsItsLiveReadExemptionSteps.js`,
   the ticket YAML with the field above, and the five role evidence files
   (`git checkout <lineage-tip> -- <path>` per file, then verify byte
   identity for every shared file). `6af9d14e87` is that shape; it can be
   rebuilt on the current tip once the field is committed with it.
3. In that rebuild, drop scenario 02's two step definitions from the
   handler ("carries an exemption marker with no reason after it", "it is
   reported as a violation"): the scenario was retired on main
   (`985b0df0b6`), the coder was never bounced for it because the parcel
   had already moved, and a step that only throws for a retired scenario
   is dead code the unreachable-step guard may refuse at land. This is a
   deletion of two blocks, no logic; record it in the evidence.
4. Send the rebuilt commit to QA. QA records the land approval as for any
   tip-pure land (BL-1405) and notes the abandoned lineage in its evidence.

The per-role commit objects will not be ancestors of the landed commit.
That is the trade `abandoned_commits` exists for (BL-1192 D1, BL-1241) and
the evidence files carry the review record; nobody rewrites `ea6628d01e`.

## What changes so this stops recurring

- `workflow-detailed.prompt` and the six pipeline-role prompts now state:
  a merge you make to sync main or to receive a parcel carries no ticket id
  in its subject. The boot-inlined article cannot take another sentence
  (43983/44000), so the rule lives one pointer away in the reference.
- Specifier mint commits keep naming several tickets in one subject when
  they mint several; the scope walk is first-parent along the parcel's own
  branch and never attributes a main commit to a parcel, so those subjects
  are not the hazard; merge subjects are.

By specifier.
