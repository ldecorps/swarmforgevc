'use strict';

// BL-1216: a DUPLICATE-ID finding names the live-lifecycle copy and flags
// content divergence. Drives the REAL specifier_backlog_hygiene_gate.bb /
// backlog_hygiene_lib.bb (BACKLOG_HYGIENE_* seams) against fixture corpora —
// never a parallel reimplementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');
const FEATURE = 'A DUPLICATE-ID finding names the live-lifecycle copy and flags content divergence';

const KNOWN_POOLS = ['paused', 'active', 'hold', 'done'];

function baseContent(id) {
  return [`id: ${id}`, 'title: "fixture"', 'type: feature', 'epic: swarm-reliability', 'milestone: M8', 'priority: 1', ''].join(
    '\n'
  );
}

function absPath(ctx, relPath) {
  return path.join(ctx.bl1216.root, relPath);
}

function writeTicket(ctx, relPath, content) {
  const full = absPath(ctx, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function runGate(env, paths) {
  const result = spawnSync('bb', [GATE, ...paths], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function gateEnv(ctx) {
  return {
    BACKLOG_HYGIENE_ROOT: path.join(ctx.bl1216.root, 'backlog'),
    BACKLOG_HYGIENE_PUBLISHED_ROOT: ctx.bl1216.published,
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contentFor(id, prose) {
  const trimmed = prose.trim();
  if (trimmed === 'different from the live copy') {
    return `${baseContent(id)}extra: field\n`;
  }
  // "byte-identical to the live copy" and "unreadable" both start from the
  // same base content — "unreadable" is made unreadable by chmod, not by
  // its bytes, so its content is irrelevant to the verdict either way.
  return baseContent(id);
}

function duplicateIdLine(output) {
  return output.split('\n').find((l) => l.startsWith('DUPLICATE-ID'));
}

// Fixture-root hygiene (BL-971/BL-529 pattern): every root the Background
// creates is registered for removal at process exit, and each new
// Background removes the previous scenario's roots eagerly, so neither a
// passing nor a throwing scenario leaves a tmp dir behind.
const fixtureRoots = [];
function registerFixtureRoot(root) {
  fixtureRoots.push(root);
}
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an empty backlog corpus$/, (ctx) => {
    if (ctx.bl1216) {
      for (const f of ctx.bl1216.unreadableFiles || []) {
        fs.chmodSync(f, 0o644);
      }
      fs.rmSync(ctx.bl1216.root, { recursive: true, force: true });
      fs.rmSync(ctx.bl1216.published, { recursive: true, force: true });
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1216-backlog-'));
    const published = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1216-published-'));
    registerFixtureRoot(root);
    registerFixtureRoot(published);
    for (const pool of KNOWN_POOLS) {
      fs.mkdirSync(path.join(root, 'backlog', pool), { recursive: true });
      fs.mkdirSync(path.join(published, pool), { recursive: true });
    }
    ctx.bl1216 = { root, published, unreadableFiles: [] };
  });

  scoped(/^ticket "([^"]+)" exists at "([^"]+)"$/, (ctx, id, relPath) => {
    writeTicket(ctx, relPath, baseContent(id));
  });

  scoped(/^ticket "([^"]+)" exists at "([^"]+)" whose contents are (.+)$/, (ctx, id, relPath, prose) => {
    const full = writeTicket(ctx, relPath, contentFor(id, prose));
    if (prose.trim() === 'unreadable') {
      fs.chmodSync(full, 0o000);
      ctx.bl1216.unreadableFiles.push(full);
    }
  });

  scoped(/^the backlog hygiene gate reports on "([^"]+)"$/, (ctx, relPath) => {
    const subject = absPath(ctx, relPath);
    ctx.bl1216.result = runGate(gateEnv(ctx), [subject]);
    // Content is read synchronously by the gate subprocess above; restore
    // perms immediately after so the tmp tree stays removable (BL-971).
    for (const f of ctx.bl1216.unreadableFiles) {
      fs.chmodSync(f, 0o644);
    }
  });

  scoped(/^a DUPLICATE-ID finding is reported for "([^"]+)"$/, (ctx, id) => {
    assert.match(ctx.bl1216.result.output, new RegExp(`DUPLICATE-ID ${id}\\b`), ctx.bl1216.result.output);
  });

  scoped(/^the finding names "([^"]+)" as the copy to keep$/, (ctx, relPath) => {
    const abs = absPath(ctx, relPath);
    assert.ok(
      ctx.bl1216.result.output.includes(`keep: ${abs}`),
      `expected "keep: ${abs}" in:\n${ctx.bl1216.result.output}`
    );
  });

  scoped(/^the finding does not name "([^"]+)" as the copy to keep$/, (ctx, relPath) => {
    const abs = absPath(ctx, relPath);
    assert.ok(
      !ctx.bl1216.result.output.includes(`keep: ${abs}`),
      `expected no "keep: ${abs}" in:\n${ctx.bl1216.result.output}`
    );
  });

  scoped(/^the finding names no copy to keep$/, (ctx) => {
    const line = duplicateIdLine(ctx.bl1216.result.output);
    assert.ok(line, `expected a DUPLICATE-ID line:\n${ctx.bl1216.result.output}`);
    assert.doesNotMatch(line, /keep:/, `expected no "keep:" in:\n${line}`);
  });

  scoped(/^the finding classifies "([^"]+)" as "(live|terminal)"$/, (ctx, relPath, cls) => {
    const abs = absPath(ctx, relPath);
    const re = new RegExp(`${escapeRe(abs)} \\[[a-z]+/${cls}\\]`);
    assert.match(ctx.bl1216.result.output, re, ctx.bl1216.result.output);
  });

  scoped(/^the finding classifies every named path as "(live|terminal)"$/, (ctx, cls) => {
    const line = duplicateIdLine(ctx.bl1216.result.output);
    assert.ok(line, `expected a DUPLICATE-ID line:\n${ctx.bl1216.result.output}`);
    const tags = [...line.matchAll(/\[[a-z]+\/([a-z]+)\]/g)].map((m) => m[1]);
    assert.ok(tags.length > 0, `expected at least one pool tag:\n${line}`);
    for (const tag of tags) {
      assert.equal(tag, cls, `expected every classification "${cls}", got [${tags.join(', ')}]\n${line}`);
    }
  });

  scoped(/^the finding states the content verdict "([^"]+)"$/, (ctx, verdict) => {
    assert.ok(
      ctx.bl1216.result.output.includes(`(${verdict};`),
      `expected content verdict "${verdict}" in:\n${ctx.bl1216.result.output}`
    );
  });
}

module.exports = { registerSteps };
