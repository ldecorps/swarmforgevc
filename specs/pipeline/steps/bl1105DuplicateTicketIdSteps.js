'use strict';

// BL-1105: duplicate ticket id refused at mint via specifier hygiene gate.
// Drives the REAL specifier_backlog_hygiene_gate.bb against fixture corpora
// (BACKLOG_HYGIENE_* seams) — never a parallel reimplementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');
const FEATURE = 'A duplicate ticket id is refused at mint, keyed on the id field';

const KNOWN_POOLS = new Set(['paused', 'active', 'hold', 'done']);

function writeTicket(dir, rel, id) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    [
      `id: ${id}`,
      'title: "fixture"',
      'type: feature',
      'epic: swarm-reliability',
      'milestone: M8',
      'priority: 1',
      '',
    ].join('\n')
  );
  return full;
}

function runGate(env, paths) {
  const result = spawnSync('bb', [GATE, ...paths], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/** Seam env for the real hygiene gate against fixture corpora. */
function gateEnv(ctx) {
  const env = { BACKLOG_HYGIENE_ROOT: ctx.bl1105.root };
  if (ctx.bl1105.unreadablePublished) {
    env.BACKLOG_HYGIENE_PUBLISHED_UNREADABLE = '1';
  } else {
    env.BACKLOG_HYGIENE_PUBLISHED_ROOT = ctx.bl1105.published;
  }
  return env;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a backlog corpus the hygiene gate reads ticket ids from$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1105-backlog-'));
    const published = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1105-published-'));
    for (const pool of KNOWN_POOLS) {
      fs.mkdirSync(path.join(root, pool), { recursive: true });
      fs.mkdirSync(path.join(published, pool), { recursive: true });
    }
    ctx.bl1105 = { root, published, unreadablePublished: false, includeMissingEpic: false };
  });

  scoped(/^the corpus already contains "([^"]+)" with id "([^"]+)"$/, (ctx, filename, id) => {
    const rel = path.join('paused', filename);
    writeTicket(ctx.bl1105.root, rel, id);
    ctx.bl1105.existingRel = rel;
  });

  scoped(/^the corpus already contains a ticket with id "([^"]+)" in "([^"]+)"$/, (ctx, id, pool) => {
    if (!KNOWN_POOLS.has(pool)) {
      throw new Error(`BL-1105: unrecognized pool "${pool}" — not in KNOWN_VALUES`);
    }
    const rel = path.join(pool, `${id}-existing-slug.yaml`);
    writeTicket(ctx.bl1105.root, rel, id);
    ctx.bl1105.existingRel = rel;
  });

  scoped(/^the corpus does not contain "([^"]+)" locally$/, (ctx, id) => {
    ctx.bl1105.expectAbsentLocal = id;
  });

  scoped(/^the published corpus contains a ticket with id "([^"]+)"$/, (ctx, id) => {
    writeTicket(ctx.bl1105.published, path.join('done', `${id}-published.yaml`), id);
  });

  scoped(/^the published corpus does not contain "([^"]+)"$/, (ctx) => {
    // Scenario 04: unique id + prove existing epic check still fires.
    ctx.bl1105.includeMissingEpic = true;
  });

  scoped(/^the published corpus cannot be read$/, (ctx) => {
    ctx.bl1105.unreadablePublished = true;
  });

  scoped(
    /^the specifier runs the hygiene gate on "([^"]+)" with id "([^"]+)"$/,
    (ctx, filename, id) => {
      const rel = path.join('paused', filename);
      const subject = writeTicket(ctx.bl1105.root, rel, id);
      ctx.bl1105.result = runGate(gateEnv(ctx), [subject]);
      ctx.bl1105.subject = subject;
    }
  );

  scoped(/^the specifier runs the hygiene gate on a new ticket whose id is "([^"]+)"$/, (ctx, id) => {
    const rel = path.join('paused', `${id}-minted-now.yaml`);
    const subject = writeTicket(ctx.bl1105.root, rel, id);
    const paths = [subject];
    if (ctx.bl1105.includeMissingEpic) {
      const bad = path.join(ctx.bl1105.root, 'paused', 'BL-9001-no-epic.yaml');
      fs.writeFileSync(bad, 'id: BL-9001\ntitle: "no epic"\ntype: feature\npriority: 1\n');
      paths.push(bad);
    }
    ctx.bl1105.result = runGate(gateEnv(ctx), paths);
    ctx.bl1105.subject = subject;
  });

  scoped(/^the gate fails$/, (ctx) => {
    assert.notEqual(ctx.bl1105.result.status, 0, `expected failure:\n${ctx.bl1105.result.output}`);
  });

  scoped(/^the gate passes$/, (ctx) => {
    // Unique id itself is clean; the missing-epic sibling still fails the run.
    assert.ok(
      !/DUPLICATE-ID BL-4242/.test(ctx.bl1105.result.output),
      `unique id must not be reported as duplicate:\n${ctx.bl1105.result.output}`
    );
  });

  scoped(/^the output reports a duplicate ticket id$/, (ctx) => {
    assert.match(ctx.bl1105.result.output, /DUPLICATE-ID/);
  });

  scoped(/^the output names both files holding that id$/, (ctx) => {
    assert.match(ctx.bl1105.result.output, /also:/);
    assert.ok(
      ctx.bl1105.result.output.includes(path.basename(ctx.bl1105.existingRel)) ||
        ctx.bl1105.result.output.includes(ctx.bl1105.existingRel),
      `output must name the existing file:\n${ctx.bl1105.result.output}`
    );
  });

  scoped(/^a ticket missing its epic in the same run is still reported$/, (ctx) => {
    assert.match(ctx.bl1105.result.output, /MISSING-EPIC/);
    assert.notEqual(ctx.bl1105.result.status, 0);
  });

  scoped(/^the output says the published corpus could not be read$/, (ctx) => {
    assert.match(ctx.bl1105.result.output, /published corpus could not be read/i);
  });
}

module.exports = { registerSteps };
