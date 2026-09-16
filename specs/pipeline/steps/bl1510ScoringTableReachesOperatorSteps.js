'use strict';

// BL-1510: step handlers for the model-scoring-table-reaches-the-operator
// feature. All four scenarios drive the real exported renderer
// (render-model-scoring-report.ts) with injected steward-runner/registry
// readers and, for scenario 04, an injected send function - the same
// "drive the real core, fake only the network/CLI boundary" posture
// bl1509FilePostedAsTelegramDocumentSteps.js established.
const assert = require('node:assert/strict');
const {
  SCORED_ROLES,
  renderScoringReport,
  renderAndSendReport,
} = require('../../../extension/out/tools/render-model-scoring-report');

const REGISTRY = [
  { provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified', cost_class: 'medium' },
  { provider: 'openai', model: 'gpt-5.3-codex', status: 'certified', cost_class: 'medium' },
  { provider: 'cerebras', model: 'llama-3.3-70b', status: 'candidate', cost_class: 'low' },
  { provider: 'mixai', model: 'mimo-v2.5', status: 'candidate', cost_class: 'low' },
];

function fixtureRunRoleMatrix(scoreOverride) {
  return (role) => {
    const score = scoreOverride && scoreOverride.role === role ? scoreOverride.score : '0.8';
    return [
      `anthropic/claude-sonnet-5 ${score} evidence/${role}-1.json`,
      `cerebras/llama-3.3-70b 0.4 evidence/${role}-2.json`,
    ];
  };
}

const FEATURE = 'BL-1510 The model-scoring table reaches the operator as a fresh attachment';

function registerSteps(registry) {
  registry.define(/^a model steward registry with certified and candidate models scored on several roles$/, (ctx) => {
    ctx.readRegistry = () => REGISTRY;
    ctx.runRoleMatrix = fixtureRunRoleMatrix();
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.define(/^the scoring report is rendered$/, (ctx) => {
    ctx.report = renderScoringReport({ runRoleMatrix: ctx.runRoleMatrix, readRegistry: ctx.readRegistry });
  });

  registry.define(/^the file holds one row for every line the steward's role-matrix returns for each scored role$/, (ctx) => {
    for (const role of SCORED_ROLES) {
      assert.match(ctx.report, new RegExp(`\\| ${role} \\|`));
    }
    // Two lines per role, seven roles.
    const rowCount = (ctx.report.match(/^\| /gm) || []).length - 1; // minus the header row
    assert.equal(rowCount, SCORED_ROLES.length * 2);
  });

  registry.define(/^every certified model's row is marked and every candidate's is not$/, (ctx) => {
    assert.match(ctx.report, /\*anthropic\/claude-sonnet-5/);
    assert.doesNotMatch(ctx.report, /\*cerebras\/llama-3\.3-70b/);
    assert.match(ctx.report, /cerebras\/llama-3\.3-70b/);
  });

  registry.define(/^each row carries the role, the model, the score and the evidence reference$/, (ctx) => {
    assert.match(ctx.report, /coder \| \*anthropic\/claude-sonnet-5 \| 0\.8 \| medium \| evidence\/coder-1\.json/);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.define(/^a first report file written from the registry$/, (ctx) => {
    ctx.firstReport = renderScoringReport({ runRoleMatrix: ctx.runRoleMatrix, readRegistry: ctx.readRegistry });
  });

  registry.define(/^a model's score changes in the registry and a second report file is written$/, (ctx) => {
    ctx.runRoleMatrix = fixtureRunRoleMatrix({ role: 'coder', score: '0.95' });
    ctx.secondReport = renderScoringReport({ runRoleMatrix: ctx.runRoleMatrix, readRegistry: ctx.readRegistry });
  });

  registry.define(/^the second file carries the new score$/, (ctx) => {
    assert.match(ctx.secondReport, /coder \| \*anthropic\/claude-sonnet-5 \| 0\.95 \|/);
    assert.doesNotMatch(ctx.firstReport, /0\.95/);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.define(/^no row names the coordinator$/, (ctx) => {
    assert.doesNotMatch(ctx.report, /\| coordinator \|/i);
  });

  registry.define(/^a footer line states that the steward does not track the coordinator as a role-matrix role$/, (ctx) => {
    assert.match(ctx.report, /does not track the coordinator as a role-matrix role/);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  // Scoped to this feature: bl1509FilePostedAsTelegramDocumentSteps.js
  // registers an unscoped `^a project root whose topic map (.+)$` that
  // would otherwise steal this identical-looking step text first (BL-425's
  // own collision shape).
  registry.defineScoped(/^a project root whose topic map names the Concierge topic$/, (ctx) => {
    ctx.sendCalls = [];
  }, FEATURE);

  registry.define(/^the render-and-send CLI runs$/, async (ctx) => {
    ctx.outcome = await renderAndSendReport(
      '/fixture-root',
      { outPath: '/fixture-root/tmp/model-scoring-report.md', send: true },
      {
        runRoleMatrix: ctx.runRoleMatrix,
        readRegistry: ctx.readRegistry,
        writeFile: () => {},
        sendReportDocument: async (projectRoot, filePath, content) => {
          ctx.sendCalls.push({ projectRoot, filePath, content });
          return { success: true };
        },
      }
    );
  });

  registry.define(/^exactly one document upload is made, to that topic, carrying the rendered file$/, (ctx) => {
    assert.equal(ctx.sendCalls.length, 1);
    assert.equal(ctx.sendCalls[0].filePath, '/fixture-root/tmp/model-scoring-report.md');
    assert.ok(ctx.sendCalls[0].content.length > 0);
    assert.equal(ctx.outcome.sent, true);
  });
}

module.exports = { registerSteps };
