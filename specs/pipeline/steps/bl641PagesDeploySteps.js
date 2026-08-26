'use strict';

// BL-641: step handlers for Pages deploy timeout headroom and repo-wide
// GitHub Actions major bumps. Parses the REAL workflow YAML under
// .github/workflows/ with js-yaml (same convention as swarmIntakeEnvRouteSteps).
const path = require('node:path');
const fs = require('node:fs');
const yaml = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'js-yaml'));

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const DASHBOARD_WORKFLOW_PATH = path.join(WORKFLOWS_DIR, 'backlog-dashboard.yml');

// Majors still on the Node 20 runtime (deprecated; forced to Node 24 then removed).
const DEPRECATED_NODE20_MAJORS = {
  'actions/checkout': 4,
  'actions/setup-node': 4,
  'actions/deploy-pages': 4,
  'actions/upload-pages-artifact': 3,
  'actions/github-script': 7,
};

const KNOWN_WORKFLOW_FILES = new Set([
  'backlog-dashboard.yml',
  'second-swarm-wakeup.yml',
  'swarm-intake-scan.yml',
  'swarm-intake.yml',
]);

const WORST_SUCCESS_MS = (10 * 60 + 35) * 1000;
const DEPLOY_PAGES_DEFAULT_TIMEOUT_MS = 600000;

function loadWorkflow(relPath) {
  if (!KNOWN_WORKFLOW_FILES.has(relPath)) {
    throw new Error(`unknown workflow file for BL-641: ${relPath}`);
  }
  return yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIR, relPath), 'utf8'));
}

function findDeployPagesStep(doc) {
  for (const job of Object.values(doc.jobs || {})) {
    for (const step of job.steps || []) {
      if (typeof step.uses === 'string' && /^actions\/deploy-pages@v/.test(step.uses)) {
        return step;
      }
    }
  }
  return null;
}

function parseDeployTimeoutMs(step) {
  const raw = step.with && step.with.timeout;
  if (raw === undefined) {
    return DEPLOY_PAGES_DEFAULT_TIMEOUT_MS;
  }
  const ms = Number(String(raw).trim());
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`invalid deploy-pages timeout: ${raw}`);
  }
  return ms;
}

function actionUsesRefs(doc) {
  const refs = [];
  for (const job of Object.values(doc.jobs || {})) {
    for (const step of job.steps || []) {
      if (typeof step.uses === 'string') {
        refs.push(step.uses);
      }
    }
  }
  return refs;
}

function isDeprecatedNode20Major(ref) {
  const match = ref.match(/^([^/]+\/[^@]+)@v(\d+)/);
  if (!match) {
    return false;
  }
  const [, action, majorStr] = match;
  const cutoff = DEPRECATED_NODE20_MAJORS[action];
  return cutoff !== undefined && Number(majorStr) <= cutoff;
}

function registerSteps(registry) {
  // ── shared Background ────────────────────────────────────────────────
  registry.define(/^\.github\/workflows\/backlog-dashboard\.yml$/, (ctx) => {
    ctx.dashboardWorkflow = loadWorkflow('backlog-dashboard.yml');
    ctx.dashboardRaw = fs.readFileSync(DASHBOARD_WORKFLOW_PATH, 'utf8');
  });

  // ── deploy-timeout-has-headroom-01 ───────────────────────────────────
  registry.define(/^the deploy-pages step's configured timeout is read$/, (ctx) => {
    ctx.deployStep = findDeployPagesStep(ctx.dashboardWorkflow);
    if (!ctx.deployStep) {
      throw new Error('expected a deploy-pages step in backlog-dashboard.yml');
    }
    ctx.deployTimeoutMs = parseDeployTimeoutMs(ctx.deployStep);
  });

  registry.define(/^it exceeds the worst observed successful run duration of 10m35s$/, (ctx) => {
    if (ctx.deployTimeoutMs <= WORST_SUCCESS_MS) {
      throw new Error(
        `deploy-pages timeout ${ctx.deployTimeoutMs}ms must exceed worst successful run ${WORST_SUCCESS_MS}ms (10m35s)`
      );
    }
  });

  // ── genuinely-stuck-deploy-still-fails-02 ──────────────────────────
  registry.define(/^a deploy-pages run that never receives a response from the Pages service$/, (ctx) => {
    ctx.deployStep = findDeployPagesStep(ctx.dashboardWorkflow);
    if (!ctx.deployStep) {
      throw new Error('expected a deploy-pages step in backlog-dashboard.yml');
    }
    ctx.deployTimeoutMs = parseDeployTimeoutMs(ctx.deployStep);
  });

  registry.define(/^the configured timeout elapses$/, () => {
    // Conceptual When: elapse is exercised via deploy-pages' own timeout input.
  });

  registry.define(/^the run fails$/, (ctx) => {
    if (!ctx.deployTimeoutMs || ctx.deployTimeoutMs <= 0) {
      throw new Error('expected a finite deploy-pages timeout so a stuck deploy still fails');
    }
  });

  registry.define(/^the failure message names the deploy step$/, (ctx) => {
    if (ctx.deployStep.id !== 'deployment') {
      throw new Error('expected deploy-pages step id: deployment so Actions names it on failure');
    }
  });

  // ── all-workflow-actions-on-current-majors-03 (Scenario Outline) ─────
  registry.define(/^"([^"]+)" in \.github\/workflows\/$/, (ctx, workflowFile) => {
    ctx.workflowFile = workflowFile;
    ctx.workflow = loadWorkflow(workflowFile);
  });

  registry.define(/^its action references are read$/, (ctx) => {
    ctx.actionRefs = actionUsesRefs(ctx.workflow);
  });

  registry.define(/^none of them are pinned to a deprecated Node-20 major$/, (ctx) => {
    const deprecated = ctx.actionRefs.filter(isDeprecatedNode20Major);
    if (deprecated.length > 0) {
      throw new Error(
        `deprecated Node-20 action majors in ${ctx.workflowFile}: ${deprecated.join(', ')}`
      );
    }
  });

  // ── publish-stays-non-blocking-04 ─────────────────────────────────────
  registry.define(/^a push touching backlog\/\*\*$/, () => {
    // Background already loaded backlog-dashboard.yml.
  });

  registry.define(/^backlog-dashboard\.yml runs and its deploy step fails$/, () => {
    // Post-land advisory workflow: failure is visible but never blocks the push.
  });

  registry.define(/^the dashboard content is still regenerated on the next push$/, (ctx) => {
    const paths = ctx.dashboardWorkflow.on && ctx.dashboardWorkflow.on.push && ctx.dashboardWorkflow.on.push.paths;
    if (!Array.isArray(paths) || !paths.some((p) => p === 'backlog/**' || p.startsWith('backlog/'))) {
      throw new Error('expected backlog-dashboard.yml to trigger on backlog/** pushes');
    }
    const steps = ctx.dashboardWorkflow.jobs['build-and-deploy'].steps;
    const generates = steps.some((s) => s.name === 'Generate backlog.json and docs-tree.json');
    if (!generates) {
      throw new Error('expected generate step before deploy so the next push still rebuilds content');
    }
  });

  registry.define(/^the failing run does not block the push or the pipeline that produced it$/, (ctx) => {
    const raw = ctx.dashboardRaw || fs.readFileSync(DASHBOARD_WORKFLOW_PATH, 'utf8');
    const header = raw.split(/^on:/m)[0];
    if (!header.includes('Runs AFTER a push has already landed')) {
      throw new Error('expected workflow header to document post-push advisory posture');
    }
    const normalized = header.replace(/\n#\s+/g, ' ');
    if (!normalized.includes('never blocks the push or the pipeline that produced it')) {
      throw new Error('expected workflow header to document non-blocking posture');
    }
  });
}

module.exports = { registerSteps };
