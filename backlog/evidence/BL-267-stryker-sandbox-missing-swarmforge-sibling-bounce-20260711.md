# BL-267 QA bounce — 2026-07-11

## 1. Failing command
```
grep -n "SIBLING_NAMES" extension/scripts/ensureStrykerSandboxSiblings.js
diff <(git show main:specs/features/BL-267-stryker-sandbox-missing-swarmforge-sibling.feature) \
     specs/features/BL-267-stryker-sandbox-missing-swarmforge-sibling.feature
```

## 2. Commit hash tested
`e24900c09e` (documenter's BL-267 handoff; QA merge commit `6ddf073` on `swarmforge-QA`).

## 3. First error excerpt
Delivered `extension/scripts/ensureStrykerSandboxSiblings.js`:
```
const SIBLING_NAMES = ['pwa', 'swarmforge', '.github'];
```
Active `backlog/active/BL-267-stryker-sandbox-missing-swarmforge-sibling.yaml` on
`main` (updated by specifier at `8b35e44`, AFTER this ticket's coder commit was
already built and forwarded through the pipeline) now requires FOUR siblings:
`{pwa, swarmforge, .github, docs}` — the delivered `SIBLING_NAMES` array is
missing `docs`.

The active `specs/features/BL-267-...feature` on `main` also carries a 4-row
Scenario Outline `Examples` table (`pwa`, `swarmforge`, `.github`, `docs`); the
delivered feature file in this commit has only 2 rows (`pwa`, `swarmforge`) and
covers `.github` only via the Background source-grep check, not as its own
Outline example.

## 4. Failure class
`behavior` — the delivered commit satisfied the ticket's acceptance criteria as
they stood when the coder built it, but the specifier expanded the ticket's
acceptance criteria (a 4th confirmed sibling, `docs/`) before this commit
reached QA. The delivered artifact no longer matches the CURRENT spec.

## 5. Expected vs observed
Expected: `SIBLING_NAMES` = `['pwa', 'swarmforge', '.github', 'docs']`, matching
the feature file's 4-row Examples table and `KNOWN_SIBLING_CHECK_FILES` including
`docs: 'GettingStarted.md'` (or equivalent), per the now-active backlog spec.
Observed: `SIBLING_NAMES` = `['pwa', 'swarmforge', '.github']` — `docs` absent
from both the sibling list and the feature file's Examples.

## Context for the coder (not a requirement override — FYI only)
QA independently ran a real scoped `stryker run` (`--mutate
out/diagrams/mermaidRender.js,out/tools/render-briefing-diagrams.js`) against the
delivered 3-sibling commit and the dry run completed WITHOUT an ENOENT on
`docs/GettingStarted.md`, reaching real mutant execution. Root cause:
`extension/test/gettingStartedDrift.test.js` already carries a defensive
`guideAvailable = fs.existsSync(GUIDE_PATH)` skip guard (its own comment names
this exact sandbox limitation) — it skips gracefully instead of throwing when
`docs/GettingStarted.md` is absent, unlike the `.github`/`swarmforge` cases which
had no such guard and hard-ENOENT. Adding `docs` to `SIBLING_NAMES` is still
correct and cheap (matches the ticket's now-active acceptance criteria and the
"trivially extensible" design), but it is defensive/consistency work rather than
something currently blocking the dry run. Worth a quick sanity check with the
specifier on whether `docs` truly belongs in the confirmed-ENOENT set language,
but not a reason to skip building it — the acceptance criteria say to build it.
