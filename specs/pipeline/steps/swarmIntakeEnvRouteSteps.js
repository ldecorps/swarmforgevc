'use strict';

// BL-227: step handlers for the swarm-intake env-route feature. Parses the
// REAL .github/workflows/swarm-intake.yml with js-yaml (resolved against
// extension's own node_modules, mirroring render-recert-mailto.js's
// jsdom-from-extension convention) and inspects each step's own `run:`
// body directly - never a hand-copied restatement of the workflow.
const path = require('node:path');
const fs = require('node:fs');
const yaml = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'js-yaml'));

const WORKFLOW_PATH = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'swarm-intake.yml');
const INTERPOLATION_PATTERN = /\$\{\{\s*(github\.event|steps)[.\s]/;

function loadWorkflow() {
  return yaml.load(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
}

function runBodies(doc) {
  const bodies = [];
  for (const job of Object.values(doc.jobs)) {
    for (const step of job.steps) {
      if (typeof step.run === 'string') {
        bodies.push({ name: step.name, run: step.run });
      }
    }
  }
  return bodies;
}

function findCommitStep(doc) {
  for (const job of Object.values(doc.jobs)) {
    const step = job.steps.find((s) => s.name === 'Commit');
    if (step) {
      return step;
    }
  }
  return null;
}

function registerSteps(registry) {
  // ── no-run-interpolation-01 ──────────────────────────────────────────
  registry.define(/^the swarm-intake workflow$/, (ctx) => {
    ctx.workflow = loadWorkflow();
  });

  registry.define(/^its run: script bodies are inspected$/, (ctx) => {
    ctx.runBodies = runBodies(ctx.workflow);
  });

  registry.define(/^none contains a \$\{\{ github\.event\.\.\. \}\} or \$\{\{ steps\.\.\. \}\} expression$/, (ctx) => {
    const offending = ctx.runBodies.filter((b) => INTERPOLATION_PATTERN.test(b.run));
    if (offending.length > 0) {
      throw new Error(
        `expected no run: body to interpolate \${{ github.event... }} or \${{ steps... }}, but found it in: ${offending
          .map((b) => b.name)
          .join(', ')}`
      );
    }
  });

  // ── commit-message-preserved-02 ──────────────────────────────────────
  registry.define(/^an issue triggers the intake workflow$/, (ctx) => {
    ctx.workflow = ctx.workflow || loadWorkflow();
    ctx.commitStep = findCommitStep(ctx.workflow);
    if (!ctx.commitStep) {
      throw new Error('expected a "Commit" step in swarm-intake.yml');
    }
  });

  registry.define(/^the Commit step runs$/, (ctx) => {
    // Nothing to execute for real (no live GitHub event/push in this test
    // environment) - the Then step below inspects the step's own env:
    // bindings and run: body directly, the same source of truth a real run
    // would use.
    ctx.envKeys = Object.keys(ctx.commitStep.env || {});
  });

  registry.define(/^the commit message still records the issue number and the issue URL$/, (ctx) => {
    const boundNum = ctx.commitStep.env && /^\$\{\{\s*github\.event\.issue\.number\s*\}\}$/.test(ctx.commitStep.env.NUM || '');
    const boundUrl = ctx.commitStep.env && /^\$\{\{\s*github\.event\.issue\.html_url\s*\}\}$/.test(ctx.commitStep.env.URL || '');
    if (!boundNum || !boundUrl) {
      throw new Error('expected the Commit step to bind NUM/URL env: keys to github.event.issue.number/html_url');
    }
    if (!/\$NUM\b/.test(ctx.commitStep.run) || !/\$URL\b/.test(ctx.commitStep.run)) {
      throw new Error('expected the commit message body to reference $NUM and $URL');
    }
    if (INTERPOLATION_PATTERN.test(ctx.commitStep.run)) {
      throw new Error('expected the commit message to no longer interpolate ${{ github.event... }} directly');
    }
  });
}

module.exports = { registerSteps };
