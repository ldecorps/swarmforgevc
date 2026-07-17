'use strict';

// BL-488: step handlers for "a role-held ticket resolves to its stage even
// when its handoff header does not lead with the id". Drives the REAL
// pipeline_stage_cli.bb (Babashka) - the same CLI BL-464's own steps
// exercise - against a real fs fixture, rather than reimplementing
// extract-ticket-id's matching logic in JS.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');

const HELD_ROLE = 'coder';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl488-ticket-id-'));
}

function writeRolesTsv(root) {
  const lines = [
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `${HELD_ROLE}\t${HELD_ROLE}\t${root}/wt-${HELD_ROLE}\tswarmforge-${HELD_ROLE}\tCoder\tclaude\ttask`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    '',
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n'));
}

function inProcessDir(root) {
  return path.join(root, `wt-${HELD_ROLE}`, '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function writeNoteHandoff(root, headerText) {
  const dir = inProcessDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '10_note.handoff'),
    `from: coordinator\nto: ${HELD_ROLE}\ntype: note\npriority: 10\nmessage: ${headerText}\n\nRe-read your role and constitution.\n\n${headerText}\n`
  );
}

function writeBacklogActive(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

function report(root) {
  return JSON.parse(execFileSync('bb', [CLI, root, 'report'], { encoding: 'utf8' }));
}

// The feature's own Scenario Outline load-bearing rule: validate resolved_id
// against an explicit KNOWN_VALUES lookup, never a bare passthrough - an
// Examples value outside this set must fail loudly rather than silently
// pass (engineering.prompt's Scenario Outline rule).
const KNOWN_VALUES = {
  'BL-476': (stageMap) => stageMap['BL-476'] === HELD_ROLE,
  NONE: (stageMap) => Object.keys(stageMap).length === 0,
};

function registerSteps(registry) {
  registry.define(/^a role holds a ticket whose handoff header text is "([^"]*)"$/, (ctx, headerText) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    writeRolesTsv(ctx.root);
    // Every Examples row in this scenario either carries BL-476 somewhere in
    // its header text or carries no id-shaped token at all - only the
    // former needs a matching backlog/active/ entry for filter-active to
    // keep it (a header with no id resolves nothing to filter regardless).
    if (headerText.includes('BL-476')) {
      writeBacklogActive(ctx.root, 'BL-476');
    }
    writeNoteHandoff(ctx.root, headerText);
  });

  registry.define(/^the board resolves the held ticket's id$/, (ctx) => {
    ctx.stageMap = report(ctx.root);
  });

  registry.define(/^it resolves to ticket "([^"]+)"$/, (ctx, resolvedId) => {
    const check = KNOWN_VALUES[resolvedId];
    if (!check) {
      throw new Error(`BL-488: unknown resolved_id "${resolvedId}" - not in KNOWN_VALUES`);
    }
    if (!check(ctx.stageMap)) {
      throw new Error(`expected resolved_id "${resolvedId}", got stage map: ${JSON.stringify(ctx.stageMap)}`);
    }
  });
}

module.exports = { registerSteps };
