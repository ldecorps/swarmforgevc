# BL-560 — architect review: PASS

Reviewed commit: `7524bd3ada` (cleaner), the same carrier commit as BL-530
(Article 2.6 — the cleaner correctly forwarded each ticket separately).
Verdict: **PASS — forward to hardener.**

BL-560's content is unchanged since the round-2 bounce of the shared commit,
where its own defect (an issue body starting with an indented line corrupting
the generated YAML) was fixed and verified. It was held only because it rode a
commit whose BL-530 content was bounced. Re-verified here at the merged commit.

## Ticket pins, checked one by one

| Pin | Status |
|---|---|
| 1. New workflow, label path untouched | `.github/workflows/swarm-intake-scan.yml` is new; `swarm-intake.yml` changes only to delegate to the shared writer |
| 2. No second YAML shape | both paths call `github_intake_write.sh` — the shape exists in exactly one place |
| 3. No `${{ }}` in a `run:` body | verified by grep: every interpolation sits in an `env:` block; the scan workflow's only `run:` is `bash swarmforge/scripts/github_intake_scan.sh` |
| 4. `GITHUB_TOKEN` only | `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` in `env:`; no new PAT, nothing written into the repo or a commit |
| 5. Dedup on issue NUMBER | `compgen -G "backlog/GH-${1}-*.yaml"` — glob on number, slug-independent |
| 6. Label applied after write as the next-run guard | `gh issue edit --add-label swarm-intake` after the push |

## Verification at the merged commit

- `bash swarmforge/scripts/test/test_github_intake_write.sh` — ALL PASS (01
  indented-first-line body, 02 plain multi-line round-trip).
- Step wiring: `bl560GithubScheduledAutoIntakeSteps` is registered in
  `specs/pipeline/steps/index.js`; loading the registry and matching all 20
  steps of `specs/features/BL-560-github-scheduled-auto-intake-scan.feature`
  leaves **0 unmatched** — no unhandled scenario for the acceptance runner to
  hard-fail on.
- `node extension/out/tools/dependency-gate.js` (full repo) — PASSED.

## Architecture

Boundary is clean and the layering is right for a scripted workflow: the
workflow YAML carries only orchestration and `env:` wiring; `github_intake_scan.sh`
owns candidate selection and git/gh IO; `github_intake_write.sh` is the single
shape-owning writer, and it is what makes the label-triggered and scheduled
paths incapable of diverging — the ticket's central design constraint expressed
as structure rather than as a convention. The `\x1f` field separator (with the
reason recorded in the header comment: bash `read` collapses runs of tab as IFS
whitespace and swallows an empty labels field) and the base64 title/body are
the correct fix for a line-oriented read of arbitrary issue text.

Secrets: token reaches the script through the process environment only, never
into the target working directory or a commit — the constitution's secrets rule
holds.

## Observation (not blocking, no rework required)

`gh issue list --state open --limit 100` silently caps the scan at 100 open
issues, and `gh`'s default ordering is newest-first, so on a repo that ever
exceeds 100 open issues the OLDEST unlabeled ones would never be intaked and
nothing would say so. Not a defect against this ticket's acceptance and far from
this repo's issue count; worth a `--paginate` (or a logged cap) if the epic's
later slices touch this file.

By architect.
