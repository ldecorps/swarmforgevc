# BL-641: Pages deploy timeout headroom and workflow action majors

Sibling of the backlog-dashboard publish workflow
(`.github/workflows/backlog-dashboard.yml`). No product behaviour changes —
only CI config.

## Deploy timeout

`actions/deploy-pages` polls the Pages service with a default **10 minute**
timeout (`600000` ms). Successful runs of this workflow have taken anywhere
from ~30s to **10m35s** for the same artifact; a run at 10m28s failed with
`Timeout reached, aborting!` (the action's own message, not repo code).

The deploy step now sets an explicit timeout of **20 minutes**
(`1200000` ms). A deploy that genuinely never completes still fails at that
limit, and GitHub Actions names the step (`id: deployment`) in the failure.

We deliberately did **not** add a job-level `timeout-minutes`: that would cap
the whole job and produce a less informative failure than the deploy step's
own message.

## Action major bumps (repo-wide)

GitHub deprecated Node 20 for JavaScript actions (forced migration to Node 24).
These four workflow files were bumped together — not piecemeal:

| Action | Before | After |
|--------|--------|-------|
| `actions/checkout` | v4 | **v5** |
| `actions/setup-node` | v4 | **v5** |
| `actions/upload-pages-artifact` | v3 | **v4** |
| `actions/deploy-pages` | v4 | **v5** |
| `actions/github-script` | v7 | **v8** |

Files touched: `backlog-dashboard.yml`, `swarm-intake-scan.yml`,
`swarm-intake.yml`. `second-swarm-wakeup.yml` has no pinned actions from this
set.

`upload-pages-artifact` is a composite action (no Node runtime of its own) but
was included so the repo is not half-migrated.

## Non-blocking posture (unchanged)

The workflow still runs **after** a push lands, is not a required status check,
and a failed deploy does not block the push or the pipeline that produced the
artifact — the next `backlog/**` push regenerates everything.

## Tests

```bash
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-641-pages-deploy-rides-its-default-timeout.feature \
  /tmp/bl641-acceptance \
  specs/pipeline/steps/bl641Only.js
```
