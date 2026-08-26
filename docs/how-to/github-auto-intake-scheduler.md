# GitHub Auto-Intake Scheduler (BL-560)

## Overview

The SwarmForge GitHub auto-intake scheduler is a GitHub Actions workflow that automatically discovers open GitHub issues and queues them for the swarm, without requiring a human to manually apply a label.

## How it works

Every 30 minutes, the scheduled workflow:

1. Lists all open GitHub issues in the repository
2. Filters for issues without a `swarm-intake` or `swarm-specced` label
3. Checks if a backlog file already exists for that issue (by issue number)
4. For any new issue without a corresponding `backlog/GH-<n>-*.yaml` file:
   - Writes the issue into the backlog as `backlog/GH-<n>-<slug>.yaml`
   - Commits it to `main`
   - Leaves a comment on the issue with the path to the created backlog file
   - Applies the `swarm-intake` label to prevent re-processing on the next scan

## The two intake paths

**Manual label-triggered** (existing): A human applies the `swarm-intake` label to an issue → the label-trigger workflow writes it to the backlog.

**Scheduled scan** (BL-560): The 30-minute schedule runs automatically → any unlabeled, unspecced open issue is auto-intake.

Both paths use the same YAML shape and write to the same backlog location, so the specifier sees a unified intake queue.

## Running the scan manually

You can trigger the scheduled workflow immediately (instead of waiting 30 minutes) via GitHub Actions:

1. Go to the **Actions** tab in your repository
2. Select the **"Scheduled GitHub issue auto-intake scan"** workflow
3. Click **"Run workflow"** and confirm

The next scan will run on the next 30-minute boundary, or immediately if you use the manual trigger.

## What issues get intaked

- **Open** issues with no `swarm-intake` label
- **No existing backlog file** for that issue number (checked on `main`)
- Issues with `swarm-specced` or `swarm-done` labels are skipped (they've already been handled)

## Deduplication

The workflow uses the issue **number** as the deduplication key (e.g., `backlog/GH-123-*.yaml`), not the slug or title. This means:

- If a human renames the issue after it's been intaken, the next scan still recognizes it
- Applying the `swarm-intake` label prevents the issue from being re-intaked on the next scan, even if the slug changes

## Parallel intakes

If two scheduled scans run in parallel (e.g., one finishes processing while another is starting), both will attempt to push their changes to `main`. The workflow handles this by rebasing on the latest `main` before pushing, ensuring no conflicts or duplicate files.

## Troubleshooting

**Issue shows as intaken but no backlog file appeared:**
Check that the workflow ran. Visit the repository's Actions tab and look for the "Scheduled GitHub issue auto-intake scan" workflow run. If it failed, the error will be logged there.

**Issue was intaken twice (two backlog files):**
This should not happen — the workflow deduplicates by issue number. If it occurs, it's a bug; report it.

**The scheduled workflow doesn't run at the expected time:**
GitHub Actions schedules are on a best-effort basis and may be delayed, especially on free plans. Use the manual trigger (workflow_dispatch) to test immediately, and rely on the scheduled runs for automation but not for strict timing guarantees.
