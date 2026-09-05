'use strict';

// BL-1418: "every enumeration of swarm roles in the code base names
// art-director... or is explicitly a pipeline-chain list... and stays
// untouched: the art director is not a stage" (invariant 1). This test
// greps the same way the ticket's own "How" direction describes - the
// literal `hardender` across extension/src and swarmforge/scripts - and
// asserts the classification directly against each enumeration's own
// source text, so the next role added does not repeat the hunt by hand:
// a SWARM-ROLES list (the whole roster, art-director included) or a
// CHAIN list (only the forward pipeline stages, art-director absent -
// it is not a stage a parcel is handed to).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// ── SWARM-ROLES lists: the whole roster, art-director included ─────────

test('BL-1418: roleTopicMapStore.ALL_SWARM_ROLES names art-director', () => {
  const src = read('extension/src/concierge/roleTopicMapStore.ts');
  const m = src.match(/export const ALL_SWARM_ROLES:[^=]*=\s*(\[[^\]]*\]);/);
  assert.ok(m, 'expected to find the ALL_SWARM_ROLES definition');
  assert.match(m[1], /'art-director'/);
});

test('BL-1418: topicIcon.ts RoleTopicIconRole and ROLE_TOPIC_ICON name art-director', () => {
  const src = read('extension/src/concierge/topicIcon.ts');
  const typeMatch = src.match(/export type RoleTopicIconRole\s*=([\s\S]*?);/);
  assert.ok(typeMatch, 'expected to find the RoleTopicIconRole type');
  assert.match(typeMatch[1], /'art-director'/);
  const mapMatch = src.match(/export const ROLE_TOPIC_ICON:[^{]*{([\s\S]*?)};/);
  assert.ok(mapMatch, 'expected to find the ROLE_TOPIC_ICON map');
  assert.match(mapMatch[1], /'art-director':\s*'[^']+'/);
});

test('BL-1418: model_factory_lib.bb swarm-roles names art-director', () => {
  const src = read('swarmforge/scripts/model_factory_lib.bb');
  const m = src.match(/\(def swarm-roles \[([^\]]*)\]\)/);
  assert.ok(m, 'expected to find the swarm-roles definition');
  assert.match(m[1], /"art-director"/);
});

// ── CHAIN lists: forward pipeline stages only - art-director is NOT a
// stage, and must never be added to any of these. ───────────────────────

test('BL-1418: rolePack.ts PIPELINE_CHAIN never names art-director', () => {
  const src = read('extension/src/swarm/rolePack.ts');
  const m = src.match(/export const PIPELINE_CHAIN:[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, 'expected to find the PIPELINE_CHAIN definition');
  assert.doesNotMatch(m[1], /art-director/);
});

test('BL-1418: swarmMetrics.ts PIPELINE_ORDER never names art-director', () => {
  const src = read('extension/src/metrics/swarmMetrics.ts');
  const m = src.match(/export const PIPELINE_ORDER\s*=\s*\[([^\]]*)\];/);
  assert.ok(m, 'expected to find the PIPELINE_ORDER definition');
  assert.doesNotMatch(m[1], /art-director/);
});

test('BL-1418: qaBounce.ts KNOWN_PRODUCING_ROLES never names art-director', () => {
  const src = read('extension/src/quality/qaBounce.ts');
  const m = src.match(/export const KNOWN_PRODUCING_ROLES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'expected to find the KNOWN_PRODUCING_ROLES definition');
  assert.doesNotMatch(m[1], /art-director/);
});

test('BL-1418: pipelineReviewOracle.ts REVIEW_STAGES never names art-director', () => {
  const src = read('extension/src/benchmark/pipelineReviewOracle.ts');
  const m = src.match(/const REVIEW_STAGES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'expected to find the REVIEW_STAGES definition');
  assert.doesNotMatch(m[1], /art-director/);
});

test('BL-1418: required_stages_lib.bb canonical chain never names art-director', () => {
  const src = read('swarmforge/scripts/required_stages_lib.bb');
  const m = src.match(/\["coder" "cleaner" "architect" "hardender" "documenter" "QA"\]/);
  assert.ok(m, 'expected to find the canonical-chain list literal');
  assert.doesNotMatch(src.slice(m.index, m.index + m[0].length), /art-director/);
});

test('BL-1418: routing_manifest_lib.bb standard-chain never names art-director', () => {
  const src = read('swarmforge/scripts/routing_manifest_lib.bb');
  const m = src.match(/\(def standard-chain[\s\S]*?\[([^\]]*)\]\)/);
  assert.ok(m, 'expected to find the standard-chain definition');
  assert.doesNotMatch(m[1], /art-director/);
});
