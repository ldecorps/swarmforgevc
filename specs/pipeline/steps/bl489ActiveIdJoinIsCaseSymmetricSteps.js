'use strict';

// BL-489: step handlers for "a role-held active ticket resolves on the
// board regardless of the letter-case of its yaml id". Drives the REAL
// `pipeline_stage_cli.bb report` (Babashka) against a real fs fixture
// (roles.tsv, a coder in_process git_handoff, a backlog/active yaml file
// whose `id:` is deliberately mis-cased) - never a hand-rolled substitute
// for active-ticket-ids' own read+join. Fixture helpers are duplicated from
// bl464PipelineBoardAuthoritativeStageSourceSteps.js's own (test_pipeline_
// stage_cli.sh-established) shape rather than cross-file-coupled to it -
// this codebase's own established "small live-glue duplicated across
// independent pure libs" posture (see pipeline_stage_lib.bb's own comment).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-active-id-case-'));
}

function writeRolesTsv(root) {
  const lines = [
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `coder\tcoder\t${root}/wt-coder\tswarmforge-coder\tCoder\tclaude\ttask`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    '',
  ];
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n'));
}

function writeBacklogActive(root, yamlId) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${yamlId}-fixture.yaml`), `id: ${yamlId}\ntitle: "fixture ticket"\n`);
}

function writeGitHandoff(root, role, ticketId) {
  const dir = path.join(root, `wt-${role}`, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '50_a.handoff'),
    `from: specifier\nto: ${role}\ntype: git_handoff\npriority: 50\ntask: ${ticketId}-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n`
  );
}

function report(root) {
  return JSON.parse(execFileSync('bb', [CLI, root, 'report'], { encoding: 'utf8' }));
}

function registerSteps(registry) {
  registry.define(/^a role holds ticket "([^"]+)" in its in_process mailbox$/, (ctx, ticketId) => {
    ctx.root = mkTmp();
    ctx.ticketId = ticketId;
    ctx.role = 'coder';
    writeRolesTsv(ctx.root);
    writeGitHandoff(ctx.root, ctx.role, ticketId);
  });

  registry.define(/^that ticket's backlog\/active yaml id is written as "([^"]+)"$/, (ctx, yamlId) => {
    writeBacklogActive(ctx.root, yamlId);
  });

  registry.define(/^the board computes the active stage map$/, (ctx) => {
    ctx.stageMap = report(ctx.root);
  });

  registry.define(/^"([^"]+)" appears on the board at that role's stage$/, (ctx, ticketId) => {
    if (ctx.stageMap[ticketId] !== ctx.role) {
      throw new Error(`expected "${ticketId}":"${ctx.role}" in the stage map, got: ${JSON.stringify(ctx.stageMap)}`);
    }
  });
}

module.exports = { registerSteps };
