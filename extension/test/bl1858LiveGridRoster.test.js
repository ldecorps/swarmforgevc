const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRosterLine, readRosterSwarmRoles } = require('../out/swarm/tmuxClient');
const { seatBaseRole, orderLiveScreenRoles } = require('../out/bridge/residentPaneLive');
const { readRoleModelId } = require('../out/swarm/backendSwitch');
const { formatModelDisplayName } = require('../out/swarm/modelDisplayName');

// BL-1858: the live grid's seats come from roles.tsv plus any sessions.tsv
// seat roles.tsv lacks; numbered seats sit after their base role; a qwen
// seat's tile names its qwen model.

function rosterRow(seat, display, agent = 'claude') {
  return `${seat}\t${seat}\t/wt/${seat}\tswarmforge-${seat}\t${display}\t${agent}`;
}

function seed(roles, sessions) {
  const tmp = mkTmpDir('sfvc-bl1858-roster-');
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  if (roles !== undefined) fs.writeFileSync(path.join(tmp, '.swarmforge', 'roles.tsv'), roles.join('\n') + '\n');
  if (sessions !== undefined) fs.writeFileSync(path.join(tmp, '.swarmforge', 'sessions.tsv'), sessions.join('\n') + '\n');
  return tmp;
}

function role(r) {
  return { index: 1, role: r, session: `swarmforge-${r}`, displayName: r, agent: 'claude' };
}

test('parseRosterLine reads role, session, display name and agent from a roles.tsv row', () => {
  assert.deepEqual(parseRosterLine(rosterRow('coder@2', 'Coder@2', 'qwen'), 4), {
    index: 4, role: 'coder@2', session: 'swarmforge-coder@2', displayName: 'Coder@2', agent: 'qwen',
  });
});

test('parseRosterLine defaults a missing agent column to unknown', () => {
  assert.equal(parseRosterLine('coder\tcoder\t/wt\tswarmforge-coder\tCoder', 1).agent, 'unknown');
});

test('parseRosterLine drops blank and short rows', () => {
  assert.equal(parseRosterLine('', 1), undefined);
  assert.equal(parseRosterLine('   ', 1), undefined);
  assert.equal(parseRosterLine('coder\tcoder\t/wt', 1), undefined);
});

test('readRosterSwarmRoles lists roles.tsv seats then sessions.tsv seats roles.tsv lacks', () => {
  const tmp = seed(
    [rosterRow('coder', 'Coder'), rosterRow('coder@2', 'Coder@2')],
    ['1\tcoordinator\tswarmforge-coordinator\tCoordinator\tclaude', '2\tcoder\tswarmforge-coder\tCoder (old)\tclaude']
  );
  const roster = readRosterSwarmRoles(tmp);
  assert.deepEqual(roster.map((r) => r.role), ['coder', 'coder@2', 'coordinator']);
  assert.equal(roster[0].displayName, 'Coder', 'a seat both list takes its roles.tsv row');
  assert.deepEqual(roster.map((r) => r.index), [1, 2, 1]);
});

test('readRosterSwarmRoles falls back to sessions.tsv alone when roles.tsv is absent', () => {
  const tmp = seed(undefined, ['1\tcoder\tswarmforge-coder\tCoder\tclaude']);
  assert.deepEqual(readRosterSwarmRoles(tmp).map((r) => r.role), ['coder']);
});

test('readRosterSwarmRoles is empty with neither file', () => {
  assert.deepEqual(readRosterSwarmRoles(seed()), []);
});

test('readRosterSwarmRoles skips a malformed roles.tsv row and keeps the rest', () => {
  const tmp = seed([rosterRow('coder', 'Coder'), 'broken\trow', rosterRow('QA', 'QA')], []);
  assert.deepEqual(readRosterSwarmRoles(tmp).map((r) => [r.role, r.index]), [['coder', 1], ['QA', 3]]);
});

test('seatBaseRole strips the seat number', () => {
  assert.equal(seatBaseRole('coder@2'), 'coder');
  assert.equal(seatBaseRole('coder@iq3'), 'coder');
  assert.equal(seatBaseRole('coder'), 'coder');
  assert.equal(seatBaseRole('@2'), '@2');
});

test('orderLiveScreenRoles puts a numbered seat right after its base role', () => {
  const ordered = orderLiveScreenRoles(['coder@2', 'QA', 'coder', 'coordinator', 'cleaner'].map(role));
  const ids = ordered.map((r) => r.role);
  assert.equal(ids[ids.indexOf('coder') + 1], 'coder@2');
  assert.ok(ids.indexOf('coder@2') < ids.indexOf('cleaner'));
});

test('orderLiveScreenRoles keeps a seat outside the chain, at the end, exactly once', () => {
  const ids = orderLiveScreenRoles(['bargain@2', 'coder', 'stranger'].map(role)).map((r) => r.role);
  assert.deepEqual(ids.slice().sort(), ['bargain@2', 'coder', 'stranger']);
  assert.equal(ids[0], 'coder');
});

function writeLaunch(tmp, seat, body) {
  const dir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${seat}.sh`), body);
}

test('readRoleModelId takes a qwen launch line over a leftover claude settings file', () => {
  const tmp = seed();
  writeLaunch(tmp, 'coder@2', '#!/bin/bash\nsource qwen_launch_guard_lib.sh\nqwen --model qwen2.5-coder-14b-q5km:latest\n');
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'launch', 'coder@2.claude-settings.json'), '{"model":"claude-sonnet-5"}');
  assert.equal(readRoleModelId(tmp, 'coder@2'), 'qwen2.5-coder-14b-q5km:latest');
});

test('readRoleModelId does not read a claude seat sourcing the qwen guard as qwen', () => {
  const tmp = seed();
  writeLaunch(tmp, 'coder', '#!/bin/bash\nsource qwen_launch_guard_lib.sh\nclaude --model claude-opus-5-5\n');
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'launch', 'coder.claude-settings.json'), '{"model":"claude-sonnet-5"}');
  assert.equal(readRoleModelId(tmp, 'coder'), 'claude-sonnet-5');
});

test('readRoleModelId does not detect qwen from the word appearing mid-line in a comment', () => {
  const tmp = seed();
  // The qwen pattern is anchored at line start on purpose: a comment that
  // merely mentions qwen (surrounded by whitespace, same as a real command
  // line) must not be mistaken for the actual command line below it.
  writeLaunch(tmp, 'coder', '#!/bin/bash\n# notes about qwen here, unrelated\nclaude --model claude-opus-5-5\n');
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'launch', 'coder.claude-settings.json'), '{"model":"claude-sonnet-5"}');
  assert.equal(readRoleModelId(tmp, 'coder'), 'claude-sonnet-5');
});

test('formatModelDisplayName names Ollama qwen coder tags', () => {
  assert.equal(formatModelDisplayName('qwen2.5-coder-14b-q5km:latest'), 'Qwen2.5 Coder 14B');
  assert.equal(formatModelDisplayName('qwen3-coder:30b'), 'Qwen3 Coder 30B');
  assert.equal(formatModelDisplayName('qwen3-coder:latest'), 'Qwen3 Coder');
  assert.equal(formatModelDisplayName('QWEN2.5-CODER-7B'), 'Qwen2.5 Coder 7B');
  assert.equal(formatModelDisplayName('qwen3:8b'), 'qwen3:8b');
});
