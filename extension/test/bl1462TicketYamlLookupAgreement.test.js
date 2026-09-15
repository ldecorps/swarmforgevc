'use strict';

// BL-1462/BL-897: the ticket-YAML search order (backlog/active, then
// backlog/paused, then backlog/done - milestone subdirectories included) is
// mirrored by hand across a boundary no import can bridge - Babashka
// (pre_qa_gate_gather_lib.bb's find-ticket-yaml-content, the real gate's own
// lookup) and Node (lib/ticketYamlLookup.js's resolveTicketYamlPath, this
// step-file world's copy of the same order, per the ticket's own direction
// to reuse rather than reimplement). This file is the gate that keeps them
// in fact agreeing, not a "kept in sync" comment on either side.
//
// Comparison is by CONTENT (bb prints the found YAML's content; the JS side
// resolves a path, read here) rather than by path string, so a future
// reshaping of either side's directory layout still compares like for like.
//
// Two-layer rule: this is TEST code invoking the real `bb` function for
// comparison, never PRODUCTION code shelling out to it - lib/ticketYamlLookup.js
// itself never shells to bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveTicketYamlPath } = require('../../specs/pipeline/steps/lib/ticketYamlLookup');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1462_find_ticket_yaml_runner.bb');

function babashkaContent(projectRoot, ticketId) {
  try {
    return execFileSync('bb', [RUNNER, projectRoot, ticketId], { encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) return null;
    throw err;
  }
}

function typescriptContent(projectRoot, ticketId) {
  const found = resolveTicketYamlPath(projectRoot, ticketId);
  return found ? fs.readFileSync(found, 'utf8') : null;
}

function mkFixture(placements) {
  const root = mkTmpDir('bl1462-agreement-');
  for (const { dir, id, name } of placements) {
    const full = path.join(root, ...dir.split('/'));
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, name), `id: ${id}\ntitle: "fixture"\n`);
  }
  return root;
}

// ── both-sides-agree-on-each-known-location-01 ────────────────────────────
for (const dir of ['backlog/active', 'backlog/paused', 'backlog/done', 'backlog/done/M8']) {
  test(`BL-1462: bb's find-ticket-yaml-content and the JS resolver agree when the ticket lives under ${dir}`, () => {
    const root = mkFixture([{ dir, id: 'BL-968', name: 'BL-968-fixture.yaml' }]);
    try {
      const babashka = babashkaContent(root, 'BL-968');
      const typescript = typescriptContent(root, 'BL-968');
      assert.ok(babashka, `bb side found nothing under ${dir}`);
      assert.equal(typescript, babashka, `JS resolver disagreed with bb under ${dir}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

// ── both-sides-agree-on-precedence-when-multiple-copies-exist-02 ──────────
// The real point of an ORDER: when stale copies exist in more than one
// location (bookkeeping mid-move, a leftover), both sides must pick the
// SAME one - active over paused over done.
test('BL-1462: bb and the JS resolver agree on precedence when the ticket YAML exists in more than one location', () => {
  const root = mkFixture([
    { dir: 'backlog/done', id: 'BL-968', name: 'BL-968-stale.yaml' },
    { dir: 'backlog/paused', id: 'BL-968', name: 'BL-968-mid-move.yaml' },
    { dir: 'backlog/active', id: 'BL-968', name: 'BL-968-current.yaml' },
  ]);
  try {
    const babashka = babashkaContent(root, 'BL-968');
    const typescript = typescriptContent(root, 'BL-968');
    assert.ok(babashka, 'bb side found nothing across active/paused/done');
    assert.equal(typescript, babashka, 'JS resolver disagreed with bb on which copy to prefer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── both-sides-agree-when-absent-03 ───────────────────────────────────────
test('BL-1462: bb and the JS resolver agree that a ticket present nowhere resolves to nothing', () => {
  const root = mkFixture([{ dir: 'backlog/active', id: 'BL-1', name: 'BL-1-unrelated.yaml' }]);
  try {
    const babashka = babashkaContent(root, 'BL-968');
    const typescript = typescriptContent(root, 'BL-968');
    assert.equal(babashka, null);
    assert.equal(typescript, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
