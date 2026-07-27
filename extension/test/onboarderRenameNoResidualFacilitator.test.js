const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-684 scenario onboarder-rename-01 (and the ticket's own "what done
// looks like" command) made a real regression test: scans every git-
// TRACKED file's content for the retired word, so a later documenter/
// cleaner/hardener pass - or an unrelated future ticket - never quietly
// reintroduces it. Two carve-outs, both principled, not convenience:
//
// 1. backlog/evidence/ and backlog/done/ (invariant 3 - the dated audit
//    trail is never rewritten, so it is excluded from the scan entirely,
//    not merely whitelisted).
// 2. A short, explicit whitelist of files that legitimately still say the
//    word because they ARE the record of the naming decision (BL-684's own
//    ticket/feature, BL-643's ruling narrative and its own "checks for the
//    word's absence" scenario), a citation to an unchanged ticket/feature
//    FILENAME (boundary 2 - filenames keep their old slug; BL-590/624/625's
//    own acceptance: path line, and bl633InvariantsSectionSteps.js's ticket
//    path constant), a delivered-Telegram-message transcript
//    (backlog/topics/*.json - rewriting a sent message misrepresents
//    history), or a design mockup that itself cites an evidence filename
//    (docs/design/BL-659-*.html).
// 3. launch_onboarder.sh and stop_ancillary_services.sh: the invariant-2
//    compat shim REQUIRES a literal old-named path to detect and clear a
//    pre-rename supervisor's artifacts - these are not vocabulary drift,
//    they are the mechanism, and are marked in-file as a compat shim to
//    drop once no pre-rename supervisor can still exist.
//
// This is an ALLOWLIST-AS-SUBSET check, not exact-set equality: a future
// ticket that legitimately cleans up one of these (e.g. BL-643 finally
// landing its own rename, or the compat shim's own eventual removal)
// shrinks the real matches without needing this test edited - only a NEW,
// unlisted match fails it.
const REPO_ROOT = path.join(__dirname, '..', '..');

const EXEMPT_PREFIXES = ['backlog/evidence/', 'backlog/done/'];

const ALLOWED_RESIDUAL_FILES = new Set([
  'backlog/active/BL-684-rename-onboarding-facilitator-to-onboarder.yaml',
  'backlog/paused/BL-590-onboarding-facilitator-agent.yaml',
  'backlog/paused/BL-624-onboarding-facilitator-survey-to-gate.yaml',
  'backlog/paused/BL-625-onboarding-facilitator-prompts-and-launch-handoff.yaml',
  'backlog/paused/BL-643-document-the-non-pipeline-agents-and-rule-on-onboarder.yaml',
  'backlog/topics/BL-590.json',
  'backlog/topics/BL-624.json',
  'backlog/topics/BL-625.json',
  'backlog/topics/BL-684.json',
  'docs/design/BL-659-traceability-explorer-mockup.html',
  'specs/features/BL-643-non-pipeline-agents-documented-as-a-class.feature.draft',
  'specs/features/BL-684-rename-onboarding-facilitator-to-onboarder.feature.draft',
  'specs/pipeline/steps/bl633InvariantsSectionSteps.js',
  'swarmforge/scripts/launch_onboarder.sh',
  'swarmforge/scripts/stop_ancillary_services.sh',
]);

function gitGrepFacilitator() {
  try {
    const out = execFileSync('git', ['grep', '-lI', '-i', 'facilitator', '--', '.'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    // git grep exits 1 (not an error) when there are zero matches.
    if (err.status === 1) {
      return [];
    }
    throw err;
  }
}

test('no live git-tracked file still says "facilitator" outside the dated record and the named naming-decision citations', () => {
  const matches = gitGrepFacilitator().filter((file) => !EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix)));
  const unexpected = matches.filter((file) => !ALLOWED_RESIDUAL_FILES.has(file));
  assert.deepEqual(unexpected, [], `unexpected residual "facilitator" mentions (BL-684): ${JSON.stringify(unexpected)}`);
});
