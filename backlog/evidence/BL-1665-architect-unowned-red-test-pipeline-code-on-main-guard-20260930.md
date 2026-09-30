# Unowned red found reviewing BL-1665: test_pipeline_code_on_main_guard.sh

While reviewing BL-1665 (architect pass), `test_pipeline_code_on_main_guard.sh`
failed case `provenance-01a`:

```
FAIL: BL-925 provenance-01a: expected the merge of an already-QA-published tip
to succeed, got: Merge refused: check_art_director_tip.sh's resolved
art-director branch swarmforge-art-director (from the swarmforge-<seat>
convention (no roles.tsv row for art-director)) does not exist.
```

**Not caused by BL-1665.** The failing assertion (line 225) is not part of
BL-1665's diff (grep -q codemod touches only `| grep -q...` pipe sites, none
near this line). Confirmed by extracting the file's content from `main`
(pre-BL-1665) into a sibling script under the same test directory and running
it directly: identical failure, byte-identical message.

**Root cause (not investigated further, not this ticket's fix):** the test's
own internal fixture builder never populates a `roles.tsv` row for
`art-director`, so `check_art_director_tip.sh`'s branch-name resolution
(the `swarmforge-<seat>` convention) cannot resolve it. Possibly related to
BL-1710 (art-director moving from a standing seat to on-demand) changing what
a "normal" roles.tsv looks like, but not confirmed.

**Ticket search:** `grep -rl "no roles.tsv row for art-director"
backlog/active/ backlog/paused/ backlog/standing-reds.tsv` — no match. Only
BL-1665 itself references the file, as the ticket fixing an unrelated pipe
shape in it.

Not blocking BL-1665's own forward (its own scope is otherwise clean); sent
as a note to the specifier for ticketing/registration.

By architect.
