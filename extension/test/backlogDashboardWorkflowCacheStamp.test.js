const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const yaml = require('js-yaml');

// BL-249: the "Stamp PWA cache name" step this ticket adds to
// .github/workflows/backlog-dashboard.yml, parsed with js-yaml and
// inspected directly - never a hand-copied restatement of the workflow.
// Mirrors specs/pipeline/steps/swarmIntakeEnvRouteSteps.js's own
// no-run-interpolation convention (BL-227/BL-092 engineering rule), applied
// here as regular unit coverage since BL-249's own Gherkin feature has no
// matching scenario for it (its qa_e2e_procedure item 5 does, but the
// coder does not hand-author acceptance scenarios).
const WORKFLOW_PATH = path.join(__dirname, '..', '..', '.github', 'workflows', 'backlog-dashboard.yml');
const INTERPOLATION_PATTERN = /\$\{\{/;

function loadWorkflow() {
  return yaml.load(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
}

function findStep(doc, name) {
  for (const job of Object.values(doc.jobs)) {
    const step = job.steps.find((s) => s.name === name);
    if (step) {
      return step;
    }
  }
  return null;
}

test('the "Stamp PWA cache name" step exists and runs the real compiled tool', () => {
  const step = findStep(loadWorkflow(), 'Stamp PWA cache name');
  assert.ok(step, 'expected a "Stamp PWA cache name" step in backlog-dashboard.yml');
  assert.match(step.run, /node extension\/out\/tools\/stamp-pwa-cache-name\.js _site/);
});

// BL-249 constraint / qa_e2e_procedure item 5 (engineering rule BL-092):
// the hash computation is file-driven, entirely inside the Node tool - this
// step's own run: body must never splice a ${{ }} expression in directly.
test('the "Stamp PWA cache name" step never interpolates a ${{ }} expression directly in its run: body', () => {
  const step = findStep(loadWorkflow(), 'Stamp PWA cache name');
  assert.ok(step, 'expected a "Stamp PWA cache name" step in backlog-dashboard.yml');
  assert.doesNotMatch(step.run, INTERPOLATION_PATTERN);
  assert.equal(step.env, undefined, 'this step needs no env: bindings at all - the tool reads real files, nothing from the event/secrets context');
});

test('the "Stamp PWA cache name" step runs after "Copy PWA static assets" (so it stamps the ASSEMBLED _site/ tree)', () => {
  const doc = loadWorkflow();
  const steps = Object.values(doc.jobs)[0].steps.map((s) => s.name);
  const copyIndex = steps.indexOf('Copy PWA static assets');
  const stampIndex = steps.indexOf('Stamp PWA cache name');
  assert.ok(copyIndex !== -1 && stampIndex !== -1, 'expected both steps to exist');
  assert.ok(stampIndex > copyIndex, 'the stamp step must run after the PWA shell has been copied into _site/');
});
