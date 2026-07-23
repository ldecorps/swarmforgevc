const assert = require('node:assert/strict');
const {
  formatResidentSpyHeader,
  renderResidentPaneSpyBody,
  inferRoleLabelFromPane,
  resolveResidentRoleIdentity,
  resolveResidentHeldTicketMeta,
  resolveResidentHeldTicketMetaForRoles,
  formatClaimEnteredAgo,
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
    formatResidentSpyHeader({ roleLabel: 'coder', modelLabel: 'Sonnet 5' }),
    'Resident: coder on Sonnet 5'
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
      modelLabel: 'Sonnet 5',
      ticketId: 'BL-529',
      ticketTitle: 'Pre-turn guard: worktree branch must match claimed ticket',
    }),
    'Resident: Architect on Sonnet 5 - BL-529 - Pre-turn guard: worktree branch must match claimed ticket'
  );
});

test('formatResidentSpyHeader omits session target when includeSession is false', () => {
  assert.equal(
    formatResidentSpyHeader(
      {
        roleLabel: 'Hardender',
        modelLabel: 'Kimi K3',
        sessionTarget: 'swarmforge-coder:0.0',
        ticketId: 'BL-529',
        ticketTitle: 'Pre-turn guard',
      },
      'Resident',
      { includeSession: false }
    ),
    'Resident: Hardender on Kimi K3 - BL-529 - Pre-turn guard'
  );
});

test('formatClaimEnteredAgo uses seconds, minutes, and hours', () => {
  const now = Date.parse('2026-07-22T12:00:00Z');
  assert.equal(formatClaimEnteredAgo(Date.parse('2026-07-22T11:59:40Z'), now), 'entered 20s ago');
  assert.equal(formatClaimEnteredAgo(Date.parse('2026-07-22T11:48:00Z'), now), 'entered 12m ago');
  assert.equal(formatClaimEnteredAgo(Date.parse('2026-07-22T09:00:00Z'), now), 'entered 3h ago');
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
    'task: BL-529-ticket-branch-mismatch-guard\ndequeued_at: 2026-07-21T10:00:00Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-529-ticket-branch-mismatch-guard.yaml'),
    'id: BL-529\ntitle: "Pre-turn guard: worktree branch must match claimed ticket"\n'
  );
  assert.deepEqual(resolveResidentHeldTicketMeta(tmp, 'coder'), {
    ticketId: 'BL-529',
    ticketTitle: 'Pre-turn guard: worktree branch must match claimed ticket',
    claimEnteredAtMs: Date.parse('2026-07-21T10:00:00Z'),
  });
});

test('resolveResidentHeldTicketMeta reads ticket id from coordinator Work BL-### note prose', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { mkTmpDir } = require('./helpers/tmpDir');
  const tmp = mkTmpDir('sfvc-resident-held-work-note-');
  const worktree = path.join(tmp, 'coder-wt');
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '10_note.handoff'),
    'type: note\nmessage: Work BL-551-llm-invocation-cost-ledger: read file in backlog/active\ndequeued_at: 2026-07-22T12:30:11Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-551-llm-invocation-cost-ledger.yaml'),
    'id: BL-551\ntitle: "LLM invocation cost ledger"\n'
  );
  assert.deepEqual(resolveResidentHeldTicketMeta(tmp, 'coder'), {
    ticketId: 'BL-551',
    ticketTitle: 'LLM invocation cost ledger',
    claimEnteredAtMs: Date.parse('2026-07-22T12:30:11Z'),
  });
});

test('resolveResidentHeldTicketMeta reads note-only in_process claims from message header', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { mkTmpDir } = require('./helpers/tmpDir');
  const tmp = mkTmpDir('sfvc-resident-held-note-');
  const worktree = path.join(tmp, 'coder-wt');
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '50_note.handoff'),
    'type: note\nmessage: BL-546 kickoff note\ndequeued_at: 2026-07-21T11:00:00Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-546-prompt-engine.yaml'),
    'id: BL-546\ntitle: "PromptEngine slice 1"\n'
  );
  assert.deepEqual(resolveResidentHeldTicketMeta(tmp, 'coder'), {
    ticketId: 'BL-546',
    ticketTitle: 'PromptEngine slice 1',
    claimEnteredAtMs: Date.parse('2026-07-21T11:00:00Z'),
  });
});

test('resolveResidentHeldTicketMetaForRoles falls back to the home role mailbox', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { mkTmpDir } = require('./helpers/tmpDir');
  const tmp = mkTmpDir('sfvc-resident-held-fallback-');
  const worktree = path.join(tmp, 'coder-wt');
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    'task: BL-529-ticket-branch-mismatch-guard\ndequeued_at: 2026-07-21T10:00:00Z\n\nbody\n'
  );
  assert.equal(
    resolveResidentHeldTicketMetaForRoles(tmp, ['hardender', 'architect', 'coder']).ticketId,
    'BL-529'
  );
});

test('renderResidentPaneSpyBody puts header above pane text', () => {
  const body = renderResidentPaneSpyBody({
    roleLabel: 'coder',
    modelLabel: 'Sonnet 5',
    paneText: 'hello',
  });
  assert.match(body, /^Resident: coder on Sonnet 5\n\nhello$/);
});
