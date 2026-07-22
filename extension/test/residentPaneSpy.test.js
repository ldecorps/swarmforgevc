const assert = require('node:assert/strict');
const {
  formatResidentSpyHeader,
  renderResidentPaneSpyBody,
  inferRoleLabelFromPane,
  resolveResidentRoleIdentity,
  resolveResidentHeldTicketMeta,
} = require('../out/concierge/residentPaneSpy');

const ROLES = [
  { role: 'coder', displayName: 'Coder' },
  { role: 'cleaner', displayName: 'Cleaner' },
];
const CODER = { role: 'coder', displayName: 'Coder' };

test('inferRoleLabelFromPane reads the SwarmForge banner role name', () => {
  const pane = 'SwarmForge Cleaner\n> doing work';
  assert.equal(inferRoleLabelFromPane(pane, ROLES), 'Cleaner');
});

test('inferRoleLabelFromPane ignores aider SwarmForge environment prose', () => {
  const pane = [
    'The user is acting as the SwarmForge environment, relaying the output of ready_for_next.sh.',
    'SwarmForge Coder',
    '> working',
  ].join('\n');
  assert.equal(inferRoleLabelFromPane(pane, ROLES), 'Coder');
});

test('resolveResidentRoleIdentity prefers mono-router active-role marker over pane text', () => {
  assert.deepEqual(
    resolveResidentRoleIdentity('SwarmForge environment\n>', CODER, ROLES, 'cleaner'),
    { roleLabel: 'Cleaner', modelRole: 'cleaner' }
  );
});

test('resolveResidentRoleIdentity maps a pane banner to the roster role and model role', () => {
  assert.deepEqual(resolveResidentRoleIdentity('SwarmForge Cleaner\n>', CODER, ROLES, undefined), {
    roleLabel: 'Cleaner',
    modelRole: 'cleaner',
  });
});

test('resolveResidentRoleIdentity falls back to the home role when the banner scrolled away', () => {
  assert.deepEqual(resolveResidentRoleIdentity('Running command...\n$ git merge', CODER, ROLES, undefined), {
    roleLabel: 'Coder',
    modelRole: 'coder',
  });
});

test('formatResidentSpyHeader includes model when present', () => {
  assert.equal(
    formatResidentSpyHeader({ roleLabel: 'coder', modelLabel: 'Sonnet 4.6' }),
    'Resident: coder on Sonnet 4.6'
  );
});

test('formatResidentSpyHeader keeps session target in parentheses', () => {
  assert.equal(
    formatResidentSpyHeader({
      roleLabel: 'Cleaner',
      modelLabel: 'Haiku 4.5',
      sessionTarget: 'swarmforge-coder:0.0',
    }),
    'Resident: Cleaner on Haiku 4.5 (swarmforge-coder:0.0)'
  );
});

test('formatResidentSpyHeader omits model clause when unknown', () => {
  assert.equal(formatResidentSpyHeader({ roleLabel: 'Coder' }), 'Resident: Coder');
});

test('formatResidentSpyHeader includes held ticket id and title after the model', () => {
  assert.equal(
    formatResidentSpyHeader({
      roleLabel: 'Architect',
      modelLabel: 'Sonnet 4.6',
      ticketId: 'BL-529',
      ticketTitle: 'Pre-turn guard: worktree branch must match claimed ticket',
    }),
    'Resident: Architect on Sonnet 4.6 - BL-529 - Pre-turn guard: worktree branch must match claimed ticket'
  );
});

test('resolveResidentHeldTicketMeta reads the in_process claim and backlog title', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { mkTmpDir } = require('./helpers/tmpDir');
  const tmp = mkTmpDir('sfvc-resident-held-ticket-');
  const worktree = path.join(tmp, 'coder-wt');
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    'task: BL-529-ticket-branch-mismatch-guard\ndequeued_at: 2026-07-21T00:00:00Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-529-ticket-branch-mismatch-guard.yaml'),
    'id: BL-529\ntitle: "Pre-turn guard: worktree branch must match claimed ticket"\n'
  );
  assert.deepEqual(resolveResidentHeldTicketMeta(tmp, 'coder'), {
    ticketId: 'BL-529',
    ticketTitle: 'Pre-turn guard: worktree branch must match claimed ticket',
  });
});

test('renderResidentPaneSpyBody puts header above pane text', () => {
  const body = renderResidentPaneSpyBody({
    roleLabel: 'coder',
    modelLabel: 'Sonnet 4.6',
    paneText: 'hello',
  });
  assert.match(body, /^Resident: coder on Sonnet 4\.6\n\nhello$/);
});
