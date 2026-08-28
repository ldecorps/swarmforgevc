'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  listActiveTicketRefs,
  auditActivePool,
  formatFinding,
  resolveDeprecateCheckCliPath,
  checkFreshnessViaCli,
} = require('../out/tools/active-pool-freshness-audit');
const { interpretFreshnessCliOutput } = require('../out/tools/deprecate-check');

function writeActiveTicket(root, filename, id, body) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body ?? `id: ${id}\ntitle: "fixture"\n`);
}

test('listActiveTicketRefs is empty when backlog/active does not exist', () => {
  const root = mkTmpDir('bl1228-noactive-');
  assert.deepEqual(listActiveTicketRefs(root), []);
});

test('listActiveTicketRefs reads the id field, not the filename slug', () => {
  const root = mkTmpDir('bl1228-idfield-');
  writeActiveTicket(root, 'BL-1-different-slug.yaml', 'BL-1', 'id: BL-1\ntitle: "x"\n');
  const refs = listActiveTicketRefs(root);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].id, 'BL-1');
  assert.equal(refs[0].path, path.join('backlog', 'active', 'BL-1-different-slug.yaml'));
});

test('listActiveTicketRefs ignores non-yaml files and only reads backlog/active', () => {
  const root = mkTmpDir('bl1228-nonyaml-');
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'BL-2-x.yaml'), 'id: BL-2\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a ticket');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-3-x.yaml'), 'id: BL-3\n');
  const refs = listActiveTicketRefs(root);
  assert.deepEqual(
    refs.map((r) => r.id),
    ['BL-2']
  );
});

// ── auditActivePool: invariant 1 — reported unless the verdict is exactly "allow" ──

test('auditActivePool reports nothing when every ticket allows', () => {
  const refs = [{ id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' }];
  const findings = auditActivePool('/root', refs, () => '{"decision":"allow"}');
  assert.deepEqual(findings, []);
});

test('auditActivePool reports a ticket the CLI holds, with the CLI reason', () => {
  const refs = [{ id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' }];
  const findings = auditActivePool('/root', refs, () => '{"decision":"hold","reason":"stale premise"}');
  assert.deepEqual(findings, [{ ticketId: 'BL-1', path: 'backlog/active/BL-1-x.yaml', reason: 'stale premise' }]);
});

test('auditActivePool fails closed on empty CLI output (missing/crashed CLI)', () => {
  const refs = [{ id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' }];
  const findings = auditActivePool('/root', refs, () => '');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ticketId, 'BL-1');
  assert.match(findings[0].reason, /empty deprecate-check output/);
});

test('auditActivePool fails closed on unparseable CLI output', () => {
  const refs = [{ id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' }];
  const findings = auditActivePool('/root', refs, () => 'not json at all');
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /malformed deprecate-check output/);
});

test('auditActivePool fails closed on an unrecognised decision value', () => {
  const refs = [{ id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' }];
  const findings = auditActivePool('/root', refs, () => '{"decision":"maybe"}');
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /malformed deprecate-check output/);
});

test('auditActivePool checks every ticket independently — one hold does not suppress an allow sibling', () => {
  const refs = [
    { id: 'BL-1', path: 'backlog/active/BL-1-x.yaml' },
    { id: 'BL-2', path: 'backlog/active/BL-2-x.yaml' },
  ];
  const findings = auditActivePool('/root', refs, (root, id) =>
    id === 'BL-1' ? '{"decision":"hold","reason":"r1"}' : '{"decision":"allow"}'
  );
  assert.deepEqual(findings, [{ ticketId: 'BL-1', path: 'backlog/active/BL-1-x.yaml', reason: 'r1' }]);
});

test('auditActivePool passes root and ticket id through to the injected checker unchanged', () => {
  const calls = [];
  auditActivePool('/my/root', [{ id: 'BL-9', path: 'p' }], (root, id) => {
    calls.push([root, id]);
    return '{"decision":"allow"}';
  });
  assert.deepEqual(calls, [['/my/root', 'BL-9']]);
});

// BL-897 discipline: active-pool-freshness-audit.ts deliberately duplicates
// deprecate-check.ts's interpretFreshnessCliOutput logic (a small,
// file-independent copy, so a renamed/missing deprecate-check.js degrades
// this module gracefully instead of crashing it at require-time — see the
// comment above interpretFreshness in the source). This test is the
// required "assert both agree" gate for that duplication: for a range of
// raw CLI outputs, auditActivePool's per-ticket verdict (reported vs not,
// and the reason) must match interpretFreshnessCliOutput's own verdict
// exactly.
test('the local interpretFreshness duplicate agrees with deprecate-check.ts/interpretFreshnessCliOutput on every sample input', () => {
  const samples = [
    '{"decision":"allow"}',
    '{"decision":"hold","reason":"stale premise"}',
    '{"decision":"hold"}',
    '{"decision":"hold","reason":""}',
    '{"decision":"maybe"}',
    '',
    '   ',
    'not json at all',
    '{"unexpected":"shape"}',
    'null',
    '[]',
  ];
  for (const raw of samples) {
    const oracle = interpretFreshnessCliOutput(raw);
    const findings = auditActivePool('/root', [{ id: 'BL-1', path: 'p' }], () => raw);
    if (oracle.decision === 'allow') {
      assert.deepEqual(findings, [], `raw ${JSON.stringify(raw)}: expected no finding (oracle: allow)`);
    } else {
      assert.equal(findings.length, 1, `raw ${JSON.stringify(raw)}: expected one finding (oracle: hold)`);
      assert.equal(findings[0].reason, oracle.reason, `raw ${JSON.stringify(raw)}: reason must match the oracle`);
    }
  }
});

test('formatFinding names the ticket, its path, and the reason', () => {
  const line = formatFinding({ ticketId: 'BL-1', path: 'backlog/active/BL-1-x.yaml', reason: 'stale premise' });
  assert.match(line, /BL-1/);
  assert.match(line, /backlog\/active\/BL-1-x\.yaml/);
  assert.match(line, /stale premise/);
});

// ── production wiring: the real CLI subprocess, never a reimplementation ──

test('resolveDeprecateCheckCliPath finds the built CLI under extension/out/tools', () => {
  const root = mkTmpDir('bl1228-clipath-');
  const toolsDir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'deprecate-check.js'), '// stub\n');
  assert.equal(resolveDeprecateCheckCliPath(root), path.join(toolsDir, 'deprecate-check.js'));
});

test('resolveDeprecateCheckCliPath is undefined when the CLI is missing', () => {
  const root = mkTmpDir('bl1228-noclipath-');
  assert.equal(resolveDeprecateCheckCliPath(root), undefined);
});

// BL-1228 qa_e2e_procedure step 3: a renamed/missing deprecate-check.js
// fails closed (empty string -> interpretFreshnessCliOutput's own hold),
// never a crash.
test('checkFreshnessViaCli returns empty (fail-closed) when the CLI is missing', () => {
  const root = mkTmpDir('bl1228-clirun-missing-');
  assert.equal(checkFreshnessViaCli(root, 'BL-1'), '');
});

// BL-1038-EXEMPT: exercises the real deprecate-check.js CLI subprocess
// against ONE fixed, nonexistent ticket id - O(1) in the repository's size
// (a single ticket lookup, not an enumeration or history walk), the same
// shape promote_and_route_next.sh's own real-CLI consult already takes.
test('checkFreshnessViaCli runs the real built CLI and returns its stdout', () => {
  // Real repo root, a ticket id unlikely to exist — exercises the CLI's own
  // fail-closed "no ticket found" path deterministically, never asserting
  // on a specific real ticket's live verdict.
  const root = path.join(__dirname, '..', '..');
  const raw = checkFreshnessViaCli(root, 'BL-999999-nonexistent');
  assert.ok(raw.length > 0, 'expected the real CLI to produce output');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.decision === 'allow' || parsed.decision === 'hold');
});
