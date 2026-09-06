'use strict';

// BL-676: step handlers for "Epic backfill proposal report". Drives the
// REAL epic_backfill_proposals_report.bb CLI (over
// swarmforge/scripts/epic_backfill_proposals_lib.bb) against a scratch
// fixture backlog tree - never a reimplementation of the classifier.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'epic_backfill_proposals_report.bb');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'Epic backfill proposal report';

// Fixed pairing the scenarios' own text assumes: console at M3, reliability
// at M5 - distinct milestones so a fixture ticket at neither cleanly maps,
// and console is deliberately the earliest so M1/M2 fixtures predate it.
const EPIC_MILESTONES = { console: 'M3', reliability: 'M5' };

function writeYaml(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function hashAllFiles(root) {
  const out = {};
  const backlogRoot = path.join(root, 'backlog');
  if (!fs.existsSync(backlogRoot)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        out[path.relative(root, abs)] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  };
  walk(backlogRoot);
  return out;
}

function parseRows(reportText) {
  const lines = reportText.split('\n').filter((l) => l.startsWith('|'));
  // Drop the header row and the `| --- | --- |...` separator row.
  return lines.slice(2).map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is '' (text before the leading |); 1..4 are id/tier/proposal/evidence.
    return { id: cells[1], tier: cells[2], proposal: cells[3], evidence: cells[4] };
  });
}

function ensureCtx(ctx) {
  ctx.root = ctx.root || mkSocketFixtureRoot('bl676-');
  return ctx;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture backlog with epic roster "([^"]+)" and done tickets nested in milestone subfolders$/, (ctx, rosterCsv) => {
    ensureCtx(ctx);
    const slugs = rosterCsv.split(',').map((s) => s.trim());
    slugs.forEach((slug, i) => {
      const milestone = EPIC_MILESTONES[slug] || `M${9 + i}`;
      const id = `BL-9${i}00`;
      writeYaml(
        ctx.root,
        `backlog/paused/${id}-epic-${slug}.yaml`,
        `id: ${id}\ntitle: "EPIC - ${slug}"\nmilestone: ${milestone}\ntype: epic\nepic: ${slug}\n`
      );
    });
  });

  scoped(/^done ticket "([^"]+)" has no epic field and milestone "([^"]+)" maps only to epic "([^"]+)"$/, (ctx, id, milestone) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\ntitle: "fixture ticket ${id}"\nmilestone: ${milestone}\n`);
  });

  scoped(/^done ticket "([^"]+)" has no epic field and its title matches roster epic "([^"]+)"$/, (ctx, id, epicSlug) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\ntitle: "${epicSlug} improvements landed"\nmilestone: M4\n`);
  });

  scoped(/^done ticket "([^"]+)" has no epic field and matches no milestone map or roster epic$/, (ctx, id) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\ntitle: "zzz qqq xyz unrelated fixture"\nmilestone: M4\n`);
  });

  scoped(/^done ticket "([^"]+)" has no epic field and its milestone predates the earliest roster epic$/, (ctx, id) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, `backlog/done/M1/${id}-fixture.yaml`, `id: ${id}\ntitle: "zzz qqq xyz unrelated fixture"\nmilestone: M1\n`);
  });

  scoped(/^done ticket "([^"]+)" already carries a non-empty epic field$/, (ctx, id) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\ntitle: "already tagged fixture"\nmilestone: M4\nepic: console\n`);
  });

  scoped(/^the fixture has untagged done tickets in two different milestone subfolders$/, (ctx) => {
    ensureCtx(ctx);
    writeYaml(ctx.root, 'backlog/done/M2/BL-901-fixture.yaml', 'id: BL-901\ntitle: "zzz qqq xyz a"\nmilestone: M2\n');
    writeYaml(ctx.root, 'backlog/done/M4/BL-902-fixture.yaml', 'id: BL-902\ntitle: "zzz qqq xyz b"\nmilestone: M4\n');
    ctx.expectedIds = ['BL-901', 'BL-902'];
  });

  scoped(/^the proposal report is generated$/, (ctx) => {
    ensureCtx(ctx);
    ctx.beforeHashes = hashAllFiles(ctx.root);
    const result = spawnSync('bb', [CLI, ctx.root], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, `expected the report CLI to exit 0, got ${result.status}: ${result.stderr}`);
    ctx.reportPath = path.join(ctx.root, 'backlog', 'evidence', 'BL-676-epic-backfill-proposals-report.md');
    ctx.reportText = fs.readFileSync(ctx.reportPath, 'utf8');
    ctx.rows = parseRows(ctx.reportText);
  });

  scoped(/^the "([^"]+)" row proposes "([^"]+)" with tier "([^"]+)" and evidence naming "([^"]+)"$/, (ctx, id, proposal, tier, evidenceNeedle) => {
    const row = ctx.rows.find((r) => r.id === id);
    assert.ok(row, `expected a row for ${id}, got rows: ${JSON.stringify(ctx.rows)}`);
    assert.equal(row.proposal, proposal);
    assert.equal(row.tier, tier);
    assert.ok(row.evidence.includes(evidenceNeedle), `expected evidence to name "${evidenceNeedle}", got "${row.evidence}"`);
  });

  scoped(/^the "([^"]+)" row proposes "([^"]+)" with tier "([^"]+)" and evidence showing the match$/, (ctx, id, proposal, tier) => {
    const row = ctx.rows.find((r) => r.id === id);
    assert.ok(row, `expected a row for ${id}, got rows: ${JSON.stringify(ctx.rows)}`);
    assert.equal(row.proposal, proposal);
    assert.equal(row.tier, tier);
    assert.ok(row.evidence && row.evidence.length > 0, 'expected non-empty evidence');
  });

  scoped(/^the "([^"]+)" row has tier "([^"]+)" and an empty proposal cell$/, (ctx, id, tier) => {
    const row = ctx.rows.find((r) => r.id === id);
    assert.ok(row, `expected a row for ${id}, got rows: ${JSON.stringify(ctx.rows)}`);
    assert.equal(row.tier, tier);
    assert.equal(row.proposal, '');
  });

  scoped(/^the "([^"]+)" row proposes "([^"]+)" with evidence citing its milestone age$/, (ctx, id, proposal) => {
    const row = ctx.rows.find((r) => r.id === id);
    assert.ok(row, `expected a row for ${id}, got rows: ${JSON.stringify(ctx.rows)}`);
    assert.equal(row.proposal, proposal);
    assert.ok(/milestone/i.test(row.evidence), `expected evidence to cite milestone age, got "${row.evidence}"`);
  });

  scoped(/^the report has no "([^"]+)" row$/, (ctx, id) => {
    const row = ctx.rows.find((r) => r.id === id);
    assert.equal(row, undefined, `expected no row for ${id}, got ${JSON.stringify(row)}`);
  });

  scoped(/^only the report file is created and every backlog file is byte-identical to before$/, (ctx) => {
    const afterHashes = hashAllFiles(ctx.root);
    for (const [file, hash] of Object.entries(ctx.beforeHashes)) {
      assert.equal(afterHashes[file], hash, `expected ${file} to be byte-identical, but it changed`);
    }
    const newFiles = Object.keys(afterHashes).filter((f) => !(f in ctx.beforeHashes));
    assert.deepEqual(newFiles, [path.relative(ctx.root, ctx.reportPath)], `expected only the report file to be new, got ${JSON.stringify(newFiles)}`);
  });

  scoped(/^each untagged done ticket appears in exactly one row$/, (ctx) => {
    for (const id of ctx.expectedIds) {
      const matches = ctx.rows.filter((r) => r.id === id);
      assert.equal(matches.length, 1, `expected exactly one row for ${id}, got ${matches.length}`);
    }
  });
}

module.exports = { registerSteps };
