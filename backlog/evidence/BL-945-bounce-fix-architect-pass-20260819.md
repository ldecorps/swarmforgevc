# BL-945 architect pass (bounce fix) — 2026-08-19

## Scope

Received directly from coder as `merge_and_process coder e0f7ddb4c1`
(priority 50, sent straight back to architect rather than through
cleaner). Ancestry confirmed: `git merge-base --is-ancestor 00317a04e3
e0f7ddb4c1` — my own BL-945 bounce commit is an ancestor, and the fix
commit's own message names D1/D2 by the same labels used in
`backlog/evidence/BL-945-architect-bounce-20260819.md`.

Files touched (`git show --stat e0f7ddb4c1`): only
`extension/test/constitutionDocCitations.test.js` (+1 comment line) and
`swarmforge/constitution/articles/project.prompt` (backtick-quoting two
existing citations, no content change).

## Checks run (complete inventory, not first-failure-stop)

1. **D1 fix — independently re-verified, not just trusted**: re-ran
   `grep -rn "docs/" swarmforge/constitution/articles/ | grep -v '\`docs/'`
   — zero non-backtick citations remain except the one bare `docs/`
   directory mention with no filename (`engineering-detailed.prompt:655`,
   correctly still unflagged, never a citation). Ran
   `extractDocCitations` directly against the real `project.prompt` text:
   now returns both `docs/reference/Specification.MD` and
   `docs/explanation/Milestone Roadmap.MD` (previously `[]`). The fix took
   the simpler of the two remediation options my bounce offered
   (backtick-normalize the outlier rather than widen the regex to handle
   an un-backticked, space-containing filename) — correctly sidesteps the
   fragility I flagged in the regex-widening path.
2. **D2 fix — independently re-verified with the actual gate, not by
   eye**: ran `bb swarmforge/scripts/pre_qa_gate_cli.bb BL-945 e0f7ddb4c1`
   — prints `OK` (previously `PRE_QA_GATE_FAIL wiring ... does not contain
   "constitution/articles"`). Confirmed the literal now appears verbatim
   in the test file's own source (a comment beside `ARTICLES_DIR`).
3. **No scope creep**: `git show --stat` confirms only the two files named
   above — no change to `Architecture Rule 6`'s substance (only two
   existing citations reformatted, confirmed by reading the diff: adds
   backticks and reflows one line, no words added or removed), no
   `epicIcon.ts`/`topicIcon.ts`, no icon-pool behavior.
4. **Full re-run of the standing suites**: guard test 6/6, property suite
   4/4, acceptance feature 4/4, clean `tsc -p ./` compile — matches the
   fix commit's own claims, independently reproduced.
5. **Dependency-rule gate (BL-259 hard gate)**: PASSED, no forbidden edges
   (ran against the one JS file in this fix's diff).
6. **Co-change report (BL-255)**: all co-changes at frequency ≤2, nothing
   above the suspected-coupling threshold (3).

## Verdict

Both D1 and D2 from my own prior bounce are fixed and independently
re-verified — D2 specifically re-confirmed against the actual mechanical
gate tool, not by inspection. No new defect found, no scope creep. This
parcel arrived from coder directly rather than via cleaner; the fix is
narrow (2 files, one comment line + a formatting-only citation change)
and every check I own passed cleanly, so I am not routing it back for a
cleaner pass on that basis alone. Forwarding to hardener.

By architect.
