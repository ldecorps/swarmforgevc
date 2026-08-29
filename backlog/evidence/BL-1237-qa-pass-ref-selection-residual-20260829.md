# BL-1237 QA pass — ref-selection defect not addressed (2026-08-29)

BL-1237 PASSES: unit (`reference_freshness_lib_test_runner.bb`), property
(3/3), acceptance (6/6), required_wiring (both entries confirmed), and
empirically verified live — `ready_for_next.sh` in this QA worktree, which
has been refusing with `STALE_REFERENCE_ELABORATION` since session start,
now proceeds correctly and resumes the in-process task.

**Not addressed, and worth specifier attention.** The ticket's own notes
(2026-08-29 entries) establish TWO defects: direction-blindness in
`stale-paths` (what this ticket fixes) and a separate ref-selection bug in
`freshest-main-ref` — it picks `main` vs `origin/main` by comparing
whole-repo ahead-counts, an unreliable proxy for per-file freshness on the
five `reference/` paths. The notes say explicitly: "Whatever ancestry probe
is built must be asked about the ref actually selected, and the selection
must stop inferring per-file freshness from a whole-repo commit count."

Checked the shipped diff (`fbeaf35b9` and the full chain): `freshest-main-ref`
is byte-for-byte unchanged. The new `path-ancestry-absorbed?` check asks
ancestry against whichever ref `freshest-main-ref` picks, so it does not
itself correct a bad ref pick — it can still fail-closed (refuse, with a
now-unclearable remedy, reproducing the original incident shape) if `main`
and `origin/main` genuinely disagree on a reference file's content with
neither side's history containing the other's touching commit.

Checked whether this is live today: `main` and `origin/main` currently agree
byte-for-byte on all five `swarmforge/constitution/articles/reference/*`
files, so there is no active incident to bounce over, and the formal
`invariants:`/`qa_e2e_procedure` (which the specifier's own note admits
"does not cover" this case) are both satisfied as written. Approving on that
basis — not bouncing a well-tested fix for a gap the ticket's own formal
contract never captured — but the architectural fragility that already
caused one live, multi-role blocking incident this shift remains, and could
recur the next time local `main` and `origin/main` diverge on a reference
file. Recommend a follow-up ticket.
