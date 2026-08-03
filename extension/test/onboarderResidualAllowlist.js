'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const EXEMPT_PREFIXES = ['backlog/evidence/', 'backlog/done/', 'docs/briefings/'];

const BACKLOG_STAGE_RE = /^backlog\/(active|paused|hold)\//;

/** Exact-path allowlist — source, docs, topics, features, tests outside backlog tickets. */
const ALLOWED_EXACT_PATHS = new Set([
  'docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md',
  'specs/features/BL-590-onboarding-facilitator-slice1-topic-prereqs.feature',
  'backlog/topics/BL-590.json',
  'backlog/topics/BL-624.json',
  'backlog/topics/BL-625.json',
  'backlog/topics/BL-684.json',
  'backlog/topics/BL-714.json',
  'docs/design/BL-659-traceability-explorer-mockup.html',
  'specs/features/BL-684-rename-onboarding-facilitator-to-onboarder.feature',
  'specs/features/BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.feature',
  'specs/pipeline/steps/bl633InvariantsSectionSteps.js',
  'specs/pipeline/steps/bl714HardeningGatesBlockedSteps.js',
  'swarmforge/scripts/launch_onboarder.sh',
  'swarmforge/scripts/stop_ancillary_services.sh',
  'extension/test/onboarderEvidenceByteIdentical.property.test.js',
  'extension/test/onboarderLauncherPidGuard.property.test.js',
  'extension/test/onboarderRenameNoResidualFacilitator.test.js',
  'extension/test/onboarderResidualAllowlist.js',
  'docs/how-to/BL-723-pilot-tonight-quality-review.md',
  'docs/reference/BL-792-test-duration-profile.md',
  'specs/pipeline/steps/bl684OnboarderRenameSteps.js',
  'specs/pipeline/steps/bl694ResidualAllowlistSteps.js',
  'swarmforge/scripts/test/test_launch_onboarder.sh',
  'swarmforge/scripts/test/test_onboarder_supervisor_ignores_old_heartbeat.sh',
  'swarmforge/scripts/test/test_stop_ancillary_services_onboarder_dual_clear.sh',
]);

/**
 * Backlog ticket files grandfathered by filename (boundary 2). Any
 * `backlog/<stage>/` path with this basename is excused — stage moves need
 * no test edit.
 */
const ALLOWED_BACKLOG_TICKET_BASENAMES = new Set([
  'BL-624-onboarding-facilitator-survey-to-gate.yaml',
  'BL-625-onboarding-facilitator-prompts-and-launch-handoff.yaml',
  'BL-643-document-the-non-pipeline-agents-and-rule-on-onboarder.yaml',
  'BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp.yaml',
]);

function gitGrepFacilitator(cwd = REPO_ROOT) {
  try {
    const out = execFileSync('git', ['grep', '-lI', '-i', 'facilitator', '--', '.'], {
      cwd,
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) {
      return [];
    }
    throw err;
  }
}

function isExemptPrefix(file) {
  return EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function backlogStagePath(stage, basename) {
  return `backlog/${stage}/${basename}`;
}

function isAllowlisted(file, opts = {}) {
  const exactPaths = opts.exactPaths ?? ALLOWED_EXACT_PATHS;
  const backlogBasenames = opts.backlogBasenames ?? ALLOWED_BACKLOG_TICKET_BASENAMES;
  if (exactPaths.has(file)) {
    return true;
  }
  if (!BACKLOG_STAGE_RE.test(file)) {
    return false;
  }
  const basename = file.slice(file.lastIndexOf('/') + 1);
  return backlogBasenames.has(basename);
}

function unexpectedResidualMatches(matches, opts = {}) {
  return matches.filter((file) => !isExemptPrefix(file) && !isAllowlisted(file, opts));
}

function scanUnexpected(extraMatches = [], opts = {}) {
  const matches = [...new Set([...gitGrepFacilitator(), ...extraMatches])];
  return unexpectedResidualMatches(matches, opts);
}

module.exports = {
  REPO_ROOT,
  EXEMPT_PREFIXES,
  BACKLOG_STAGE_RE,
  ALLOWED_EXACT_PATHS,
  ALLOWED_BACKLOG_TICKET_BASENAMES,
  gitGrepFacilitator,
  isExemptPrefix,
  isAllowlisted,
  backlogStagePath,
  unexpectedResidualMatches,
  scanUnexpected,
};
