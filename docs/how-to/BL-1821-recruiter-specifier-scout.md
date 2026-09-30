# BL-1821 — the recruiter's weekly specifier scout

`recruiter_weekly.sh` picks one Hugging Face model per run and batteries it
for the coder role only. The specifier scout is a separate, weekly pass
that batteries a **batch** of unseen candidates for the specifier seat and
keeps a standing score table answering "is it still the best?". A better
challenger is an offer for the human — the scout never seats anything.

## What it does

`swarmforge/scripts/recruiter_specifier_scout.sh <project-root> [--batch N]`
(default `N=3`):

1. **discover** — `recruiter_hf_discover.py --batch N`: up to N unseen,
   trusted, host-fitting GGUF candidates (rule-based, no LLM), same
   novelty/trust/size/quant rules as the single-pick coder path.
2. **acquire** — pulls each candidate into Ollama and aliases it
   (skipped entirely in a stub run).
3. **battery** — runs `local_specifier_battery.py` (BL-1819/BL-1820) on
   every acquired candidate AND on the incumbent: the steward's current
   top certified `local/*` model for specifier
   (`model_steward_cli.bb role-matrix specifier`; no incumbent means no
   incumbent row).
4. **score** — writes `.swarmforge/recruiter/score-table.json`: one row
   per model batteried (role, model/alias, Hugging Face id if any,
   battery stamp, evidence path, passed/total, incumbent flag,
   `updated_at`). A model's older row is replaced, not duplicated.
5. **recommend** — one line per role: the best challenger only when it
   passes MORE competencies than the incumbent (a tie keeps the
   incumbent).
6. **report** — `backlog/evidence/recruiter-specifier-scout-<stamp>.md`
   (uncommitted, same posture as the weekly coder report) plus one line
   to the Operator Telegram topic.

The scout keeps its own seen list, `.swarmforge/recruiter/seen-specifier.jsonl`,
marking each candidate there before pulling it. Its batch skips only models
already on that list — it never reads or writes the weekly coder path's own
`.swarmforge/recruiter/seen.jsonl`, so the two paths cannot starve each
other of candidates. The scout's writes are exactly: the score table, its
report, its own seen list, and the battery's own evidence. It never touches
a pack conf, `swarmforge.conf`, a seat, or a git ref, and never commits.

## Cadence

Called from `recruiter_nightly.sh`'s existing weeknight hook, once a week
(Monday UTC) — a batch pass costs several times one coder-battery run, so
it does not run nightly. It stands down while a local pack's aider seat is
live (the same single-inference-slot reasoning as the steward coder
probe, BL-1701) and runs after everything else in that hook.

## Knobs

- `RECRUITER_SPECIFIER_BATCH` — batch size N (default 3).
- `RECRUITER_SPECIFIER_SCOUT_SCRIPT` — override the script path.
- `RECRUITER_SPECIFIER_SCOUT_FORCE=1` — test-only seam, runs regardless of
  the day. Never for operator use.

Test-only seams inside `recruiter_specifier_scout.sh` itself
(`RECRUITER_SPECIFIER_STUB_DISCOVER_JSON`, `RECRUITER_SPECIFIER_SKIP_PULL`,
`RECRUITER_SPECIFIER_INCUMBENT_MODEL`, `RECRUITER_SPECIFIER_STUB_ANSWERS_DIR`)
let the acceptance lane and unit tests run the whole pipeline with no
network or Ollama; none of them are for operator use either.

## What is not here yet

Publishing the score table into the daily briefing is a separate slice
(BL-1822), not yet landed. Staffing a local specifier seat from the table
(a gate mirroring [Local coder evidence bar](BL-1127-local-coder-steward-evidence-bar.md))
is a recorded follow-on, not minted: it becomes due when a local
specifier seat is the next staffing goal.

## Related

- [The model steward's coder probe](BL-1700-model-steward-coder-probe.md) —
  the sibling nightly probe this scout stands beside in the same hook.
- [Local coder evidence bar](BL-1127-local-coder-steward-evidence-bar.md) —
  the shape a future specifier staffing gate would mirror.
