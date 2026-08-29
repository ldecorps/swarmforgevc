const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { executeOperatorVerb } = require('../out/tools/telegramCursorOperatorExec');
const {
  runOperatorPostmortem,
  findRecentClearedIncident,
  inferFailureClass,
} = require('../out/tools/operatorPostmortem');

function writeIncident(root, incident) {
  const filePath = path.join(root, '.swarmforge', 'incidents', 'disaster-incidents.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify([incident], null, 2)}\n`, 'utf8');
}

test('BL-1170: refuses when no recent cleared disaster incident exists', () => {
  const root = mkTmpDir('bl1170-refuse-');
  const result = runOperatorPostmortem(root);
  assert.equal(result.outcome, 'refused');
  assert.match(result.reason, /nothing to postmortem/i);
  const executed = executeOperatorVerb(root, '/postmortem');
  assert.match(executed.text, /nothing to postmortem/i);
});

test('BL-1170: postmortem writes registry, playbook, qualified record, and intake stub', () => {
  const root = mkTmpDir('bl1170-ok-');
  writeIncident(root, {
    id: 'inc-1',
    status: 'cleared',
    opened_at: '2026-08-27T10:00:00Z',
    cleared_at: '2026-08-27T10:30:00Z',
    failure_class: 'starvation-cascade',
    postmortem_key: 'starvation-cascade:20260827T100000Z',
  });
  const result = runOperatorPostmortem(root, undefined, { nowMs: Date.parse('2026-08-27T12:00:00Z') });
  assert.equal(result.outcome, 'ok');
  assert.ok(fs.existsSync(path.join(root, '.swarmforge/babysitter/failure-classes.json')));
  assert.ok(fs.existsSync(path.join(root, '.swarmforge/operator/failure-class-playbooks.json')));
  assert.ok(fs.existsSync(path.join(root, result.intakePath)));
  assert.ok(fs.existsSync(path.join(root, '.swarmforge/operator/postmortem-records/inc-1.json')));
});

test('BL-1170: idempotent — second postmortem for same incident window refuses', () => {
  const root = mkTmpDir('bl1170-idem-');
  writeIncident(root, {
    id: 'inc-2',
    status: 'cleared',
    opened_at: '2026-08-27T10:00:00Z',
    cleared_at: '2026-08-27T10:30:00Z',
    failure_class: 'starvation-cascade',
    postmortem_key: 'starvation-cascade:20260827T100000Z',
  });
  const first = runOperatorPostmortem(root, undefined, { nowMs: Date.parse('2026-08-27T12:00:00Z') });
  assert.equal(first.outcome, 'ok');
  const second = runOperatorPostmortem(root, undefined, { nowMs: Date.parse('2026-08-27T12:05:00Z') });
  assert.equal(second.outcome, 'refused');
});

test('BL-1170: parse-error class playbook requires human hotfix', () => {
  const root = mkTmpDir('bl1170-parse-');
  writeIncident(root, {
    id: 'inc-parse',
    status: 'cleared',
    opened_at: '2026-08-27T11:00:00Z',
    cleared_at: '2026-08-27T11:05:00Z',
    handoffd_startup_error: 'Parse error at line 42',
    postmortem_key: 'handoffd-parse-dead:20260827T110000Z',
  });
  const result = runOperatorPostmortem(root, undefined, { nowMs: Date.parse('2026-08-27T12:00:00Z') });
  assert.equal(result.outcome, 'ok');
  assert.equal(inferFailureClass({ id: 'x', status: 'cleared', opened_at: 't', handoffd_startup_error: 'Parse error' }), 'handoffd-parse-dead');
  const playbook = JSON.parse(
    fs.readFileSync(path.join(root, '.swarmforge/operator/failure-class-playbooks.json'), 'utf8')
  );
  assert.equal(playbook['handoffd-parse-dead'].human_hotfix_required, true);
});

test('BL-1170: findRecentClearedIncident honors lookback window', () => {
  const root = mkTmpDir('bl1170-lookback-');
  writeIncident(root, {
    id: 'old',
    status: 'cleared',
    opened_at: '2026-01-01T00:00:00Z',
    cleared_at: '2026-01-01T01:00:00Z',
    failure_class: 'starvation-cascade',
  });
  const found = findRecentClearedIncident(root, undefined, Date.parse('2026-08-27T12:00:00Z'), 24 * 60 * 60 * 1000);
  assert.equal(found, undefined);
});
